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

// CORS konfigurācija, iekļaujot atļautās izcelsmes un exposedHeaders
const cors = require("cors")({
  origin: [
    "https://cdify-smu.web.app",
    "https://cdify-smu.firebaseapp.com",
    "https://home.jalatvia.lv",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ],
  exposedHeaders: ["ETag"],
});

admin.initializeApp();
const db = admin.firestore();

const R2_ACCOUNT_ID = defineSecret("R2_ACCOUNT_ID");
const R2_BUCKET_NAME = defineString("R2_BUCKET_NAME", { default: "r2cdify" });
const R2_PUBLIC_DOMAIN = defineString("R2_PUBLIC_DOMAIN", { default: "" });
const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const MAX_FILE_SIZE = 700 * 1024 * 1024;
const ORDER_NUMBER_PATTERN = /^\d+-[A-Za-z0-9-]{1,60}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_KEY_PATTERN = /^uploads\/\d+-[A-Za-z0-9-]{1,60}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-zA-Z0-9._-]{1,120}$/;

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

function toOrderNameSlug(name) {
  const words = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").match(/[A-Za-z0-9]+/g) || [];
  const slug = words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join("-")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "Klients";
}

function validateFiles(files, orderNumber) {
  if (!Array.isArray(files)) return false;
  const keys = new Set();

  return files.every((file) => {
    if (
      !file ||
      typeof file.key !== "string" ||
      !FILE_KEY_PATTERN.test(file.key) ||
      !file.key.startsWith(`uploads/${orderNumber}-`) ||
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
  const orderNumber = requestType === "order" ? body.orderNumber : null;
  if (
    !["order", "question", "suggestion"].includes(requestType) ||
    (requestType === "order" && !ORDER_NUMBER_PATTERN.test(orderNumber || "")) ||
    !validateFiles(body.files, orderNumber)
  ) {
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
    submission.orderNumber = orderNumber;
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

function parseRequestBody(body, rawBody) {
  // For text/plain, Firebase may expose an empty req.body while preserving the
  // actual JSON payload in rawBody. Prefer rawBody so the empty object cannot mask it.
  for (let candidate of [rawBody, body]) {
    if (Buffer.isBuffer(candidate)) candidate = candidate.toString("utf8");
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
}

exports.api = onRequest({
  region: "europe-west1",
  secrets: [R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY],
}, async (req, res) => {
  return cors(req, res, async () => {
    try {
      const path = req.path.replace(/^\/api(?=\/)/, "");
      const body = parseRequestBody(req.body, req.rawBody);
      const bucketName = R2_BUCKET_NAME.value();

      if (req.method === "POST" && path === "/start-order") {
        if (typeof body?.name !== "string" || body.name.trim().length < 2 || body.name.length > 120) {
          return res.status(400).json({ error: "Lūdzu, norādiet derīgu vārdu un uzvārdu." });
        }

        const nameSlug = toOrderNameSlug(body.name.trim());
        const sequenceRef = db.collection("_system").doc("order-sequence");
        const orderNumber = await db.runTransaction(async (transaction) => {
          const sequenceSnapshot = await transaction.get(sequenceRef);
          const previousSequence = sequenceSnapshot.exists ? sequenceSnapshot.get("lastSequence") : 0;
          if (!Number.isSafeInteger(previousSequence) || previousSequence < 0) {
            throw new Error("Order sequence in Firestore is invalid.");
          }

          const nextSequence = previousSequence + 1;
          if (!Number.isSafeInteger(nextSequence)) {
            throw new Error("Order sequence has reached its maximum value.");
          }

          const nextOrderNumber = `${nextSequence}-${nameSlug}-${randomUUID()}`;
          transaction.set(sequenceRef, {
            lastSequence: nextSequence,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          transaction.create(db.collection("_orderReservations").doc(nextOrderNumber), {
            orderNumber: nextOrderNumber,
            nameSlug,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return nextOrderNumber;
        });

        return res.json({ orderNumber });
      }

      if (req.method === "POST" && path === "/get-upload-url") {
        const { orderNumber, fileName, fileType, fileSize, field } = body || {};
        if (
          !ORDER_NUMBER_PATTERN.test(orderNumber || "") ||
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
        const fileKey = `uploads/${orderNumber}-${randomUUID()}-${safeFileName}`;

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          ContentType: fileType,
          Metadata: {
            "order-number": orderNumber,
            "file-field": field,
          },
        });
        const uploadUrl = await getSignedUrl(createS3Client(), command, {
          expiresIn: 3600,
          unhoistableHeaders: new Set([
            "x-amz-meta-order-number",
            "x-amz-meta-file-field",
          ]),
        });
        const publicDomain = R2_PUBLIC_DOMAIN.value().trim().replace(/\/+$/, "");

        return res.json({
          uploadUrl,
          fileKey,
          uploadHeaders: {
            "x-amz-meta-order-number": orderNumber,
            "x-amz-meta-file-field": field,
          },
          publicUrl: publicDomain ? `${publicDomain}/${fileKey}` : null,
        });
      }

      if (req.method === "POST" && path === "/submit-order") {
        const submission = normalizeSubmission(body);
        if (!submission) {
          return res.status(400).json({ error: "Iesniegtie dati nav derīgi." });
        }

        const verifiedFiles = [];
        const publicDomain = R2_PUBLIC_DOMAIN.value().trim().replace(/\/+$/, "");
        if (submission.files.length) {
          const s3Client = createS3Client();
          for (const file of submission.files) {
            const uploaded = await s3Client.send(new HeadObjectCommand({
              Bucket: bucketName,
              Key: file.key,
            }));
            if (
              uploaded.ContentLength !== file.size ||
              uploaded.Metadata?.["order-number"] !== submission.orderNumber ||
              uploaded.Metadata?.["file-field"] !== file.field
            ) {
              return res.status(400).json({ error: "Augšupielādētā faila dati nesakrīt." });
            }

            verifiedFiles.push({
              ...file,
              contentType: uploaded.ContentType || file.contentType,
              size: uploaded.ContentLength,
              storage: {
                provider: "cloudflare-r2",
                bucket: bucketName,
                etag: uploaded.ETag || null,
                uploadedAt: uploaded.LastModified || null,
                publicUrl: publicDomain ? `${publicDomain}/${file.key}` : null,
              },
            });
          }
        }

        const docRef = submission.requestType === "order"
          ? db.collection("orders").doc(submission.orderNumber)
          : db.collection("orders").doc();
        const orderData = {
          ...submission,
          files: verifiedFiles,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (submission.requestType === "order") {
          const reservationRef = db.collection("_orderReservations").doc(submission.orderNumber);
          const reservationUsed = await db.runTransaction(async (transaction) => {
            const reservationSnapshot = await transaction.get(reservationRef);
            const existingOrderSnapshot = await transaction.get(docRef);
            if (
              !reservationSnapshot.exists ||
              reservationSnapshot.get("nameSlug") !== toOrderNameSlug(submission.name) ||
              existingOrderSnapshot.exists
            ) {
              return false;
            }

            transaction.create(docRef, orderData);
            transaction.delete(reservationRef);
            return true;
          });
          if (!reservationUsed) {
            return res.status(400).json({ error: "Pasūtījuma numurs nav derīgs vai jau izmantots." });
          }
        } else {
          await docRef.create(orderData);
        }

        return res.json({ success: true, orderId: docRef.id, orderNumber: submission.orderNumber });
      }

      return res.status(404).send("Not Found");
    } catch (error) {
      console.error("API Kļūda:", error);
      return res.status(500).json({ error: "Servera kļūda. Lūdzu, mēģiniet vēlreiz." });
    }
  });
});
