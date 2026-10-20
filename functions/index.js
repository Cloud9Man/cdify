const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { randomUUID } = require("node:crypto");
const {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

admin.initializeApp();
const db = admin.firestore();

const R2_ACCOUNT_ID = defineString("R2_ACCOUNT_ID");
const R2_BUCKET_NAME = defineString("R2_BUCKET_NAME", { default: "r2cdify" });
const R2_PUBLIC_DOMAIN = defineString("R2_PUBLIC_DOMAIN", { default: "" });
const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const MAX_FILE_SIZE = 700 * 1024 * 1024;

const ORDER_PRODUCTS = {
  vinyl: { unitPrice: 1.5, options: { optionVinylBurn: 0.25 } },
  lightscribe: {
    unitPrice: 2,
    options: {
      optionLightscribeReadableFinish: 0.5,
      optionLightscribeUnreadableFinish: 0.5,
      optionLightscribeBurn: 0.25,
    },
  },
  standard: {
    unitPrice: 1,
    options: {
      optionStandardReadableFinish: 0.5,
      optionStandardBurn: 0.25,
    },
  },
  cases: { unitPrice: 1, options: { optionCasesFinish: 0.5 } },
};

const ALLOWED_FILE_FIELDS = new Set([
  "artworkLightscribeReadable",
  "artworkLightscribeUnreadable",
  "artworkStandardReadable",
  "artworkCaseFront",
  "artworkCaseBack",
  "burningVinyl",
  "burningLightscribe",
  "burningStandard",
]);

function createS3Client() {
  const accountId = R2_ACCOUNT_ID.value();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID.value(),
      secretAccessKey: R2_SECRET_ACCESS_KEY.value(),
    },
  });
}

function validateContact(body) {
  if (
    typeof body.name !== "string" ||
    body.name.trim().length < 2 ||
    body.name.length > 120 ||
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email.trim())
  ) {
    return false;
  }
  return true;
}

function validateFiles(files) {
  if (!Array.isArray(files)) return false;
  const keys = new Set();

  return files.every((file) => {
    if (
      !file ||
      typeof file.key !== "string" ||
      !/^uploads\/[a-f0-9-]{36}-[a-zA-Z0-9._-]{1,120}$/.test(file.key) ||
      keys.has(file.key) ||
      typeof file.name !== "string" ||
      file.name.length < 1 ||
      file.name.length > 255 ||
      typeof file.contentType !== "string" ||
      file.contentType.length > 128 ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(file.contentType) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_FILE_SIZE ||
      !ALLOWED_FILE_FIELDS.has(file.field)
    ) {
      return false;
    }
    keys.add(file.key);
    return true;
  });
}

function filesMatchOrder(items, files) {
  const expectedFields = new Set();
  const requiredFields = new Set();
  const optionFiles = {
    optionLightscribeReadableFinish: ["artworkLightscribeReadable"],
    optionLightscribeUnreadableFinish: ["artworkLightscribeUnreadable"],
    optionStandardReadableFinish: ["artworkStandardReadable"],
    optionCasesFinish: ["artworkCaseFront", "artworkCaseBack"],
    optionVinylBurn: ["burningVinyl"],
    optionLightscribeBurn: ["burningLightscribe"],
    optionStandardBurn: ["burningStandard"],
  };

  for (const item of items) {
    for (const option of item.options) {
      for (const field of optionFiles[option] || []) {
        expectedFields.add(field);
        requiredFields.add(field);
      }
    }
  }

  return [...requiredFields].every((field) => files.some((file) => file.field === field)) &&
    files.every((file) => expectedFields.has(file.field));
}

function normalizeSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !validateContact(body)) {
    return null;
  }

  const requestType = body.requestType;
  if (!["order", "question", "suggestion"].includes(requestType) || !validateFiles(body.files)) {
    return null;
  }

  const submission = {
    requestType,
    name: body.name.trim(),
    email: body.email.trim(),
    files: body.files.map(({ key, name, contentType, size, field }) => ({
      key,
      name,
      contentType,
      size,
      field,
    })),
    status: "jauns",
  };

  if (requestType === "order") {
    if (
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > Object.keys(ORDER_PRODUCTS).length ||
      typeof body.details !== "string" ||
      body.details.trim().length < 10 ||
      body.details.length > 5000 ||
      !Number.isSafeInteger(body.estimatedTotalCents) ||
      body.estimatedTotalCents < 0
    ) {
      return null;
    }

    const products = new Set();
    let estimatedTotalCents = 0;
    const items = [];
    for (const item of body.items) {
      const product = ORDER_PRODUCTS[item?.product];
      if (
        !product ||
        products.has(item.product) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 100000 ||
        !Array.isArray(item.options) ||
        new Set(item.options).size !== item.options.length ||
        item.options.some((option) => !Object.hasOwn(product.options, option))
      ) {
        return null;
      }

      products.add(item.product);
      const unitPriceCents = Math.round(product.unitPrice * 100) +
        item.options.reduce((sum, option) => sum + Math.round(product.options[option] * 100), 0);
      estimatedTotalCents += unitPriceCents * item.quantity;
      items.push({
        product: item.product,
        quantity: item.quantity,
        options: item.options,
      });
    }

    if (!filesMatchOrder(items, submission.files)) return null;
    submission.items = items;
    submission.details = body.details.trim();
    submission.estimatedTotalCents = estimatedTotalCents;
    return submission;
  }

  if (
    typeof body.subject !== "string" ||
    body.subject.trim().length < 2 ||
    body.subject.length > 150 ||
    typeof body.details !== "string" ||
    body.details.trim().length < 10 ||
    body.details.length > 5000 ||
    submission.files.length > 0
  ) {
    return null;
  }

  submission.subject = body.subject.trim();
  submission.details = body.details.trim();
  return submission;
}

function parseRequestBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

exports.api = onRequest({
  region: "europe-west1",
  cors: [
    "https://cdify-smu.web.app",
    "https://cdify-smu.firebaseapp.com",
    "https://home.jalatvia.lv",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ],
  secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY],
}, async (req, res) => {
  try {
    const path = req.path.replace(/^\/api(?=\/)/, "");
    const body = parseRequestBody(req.body);
    const bucketName = R2_BUCKET_NAME.value();

    if (req.method === "POST" && path === "/get-upload-url") {
      const { fileName, fileType, fileSize, field } = body || {};
      if (
        typeof fileName !== "string" ||
        fileName.trim().length < 1 ||
        fileName.length > 255 ||
        typeof fileType !== "string" ||
        fileType.length > 128 ||
        !/^[\w.+-]+\/[\w.+-]+$/.test(fileType) ||
        !Number.isSafeInteger(fileSize) ||
        fileSize < 1 ||
        fileSize > MAX_FILE_SIZE ||
        !ALLOWED_FILE_FIELDS.has(field)
      ) {
        return res.status(400).json({ error: "Faila informācija nav derīga." });
      }

      const safeFileName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
      const fileKey = `uploads/${randomUUID()}-${safeFileName}`;
      
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: fileType, // Pievienots, lai sakristu ar klienta sūtīto Content-Type galveni
      });
      const uploadUrl = await getSignedUrl(createS3Client(), command, { expiresIn: 3600 });
      const publicDomain = R2_PUBLIC_DOMAIN.value().trim().replace(/\/+$/, "");

      return res.json({
        uploadUrl,
        fileKey,
        publicUrl: publicDomain ? `${publicDomain}/${fileKey}` : null,
      });
    }

    if (req.method === "POST" && path === "/submit-order") {
      const submission = normalizeSubmission(body);
      if (!submission) {
        return res.status(400).json({ error: "Iesniegtie dati nav derīgi." });
      }

      if (submission.files.length) {
        const s3Client = createS3Client();
        for (const file of submission.files) {
          const uploaded = await s3Client.send(new HeadObjectCommand({
            Bucket: bucketName,
            Key: file.key,
          }));
          if (uploaded.ContentLength !== file.size) {
            return res.status(400).json({ error: "Augšupielādētā faila dati nesakrīt." });
          }
        }
      }

      const docRef = await db.collection("orders").add({
        ...submission,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ success: true, orderId: docRef.id });
    }

    return res.status(404).send("Not Found");
  } catch (error) {
    console.error("API Kļūda:", error);
    return res.status(500).json({ error: "Servera kļūda. Lūdzu, mēģiniet vēlreiz." });
  }
});