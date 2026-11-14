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
    "https://cdify.xyz",
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
const ORDER_NUMBER_PATTERN = /^\d+-[A-Za-z0-9-]{1,60}-(?:Vinila-\d+(?:-Parastie-\d+)?(?:-Parastais-dead-\d+)?(?:-Futlari-\d+)?|Parastie-\d+(?:-Parastais-dead-\d+)?(?:-Futlari-\d+)?|Parastais-dead-\d+(?:-Futlari-\d+)?|Futlari-\d+|Pasutijums)$/;

const ORDER_PRODUCTS = {
  vinyl: { unitPrice: 1.5, options: { optionVinylSurface: 0.5, optionVinylBurn: 0.25 } },
  standard: {
    unitPrice: 1,
    options: { optionStandardSurface: 0.5, optionStandardBurn: 0.25, optionStandardImageBurn: 0.25 },
  },
  "parastais-dead": { unitPrice: 0.5, options: { optionStandardPrintSurface: 0.5 } },
  cases: { unitPrice: 1, options: { optionCasesFinish: 0.5 } },
};

const ALLOWED_FILE_FIELDS = new Set([
  "artworkVinylSurface",
  "artworkStandardSurface",
  "artworkStandardPrintSurface",
  "artworkCaseFront",
  "artworkCaseBack",
  "burningVinyl",
  "burningStandard",
  "burningStandardImage",
]);

function createS3Client() {
  const accountId = R2_ACCOUNT_ID.value();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
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

function toOrderSummary(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > Object.keys(ORDER_PRODUCTS).length) return null;
  const labels = { vinyl: "Vinila", standard: "Parastie", "parastais-dead": "Parastais-dead", cases: "Futlari" };
  const seen = new Set();
  for (const item of items) {
    if (!item || !Object.hasOwn(labels, item.product) || seen.has(item.product) ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) return null;
    seen.add(item.product);
  }
  return ["vinyl", "standard", "parastais-dead", "cases"]
    .filter((product) => seen.has(product))
    .map((product) => `${labels[product]}-${items.find((item) => item.product === product).quantity}`)
    .join("-");
}

function validateFiles(files, orderNumber) {
  if (!Array.isArray(files)) return false;
  const keys = new Set();

  return files.every((file) => {
    if (
      !file ||
      typeof file.key !== "string" ||
      !file.key.startsWith(`orders/${orderNumber}/`) ||
      file.key.split("/")[1] !== orderNumber ||
      !/^orders\/[\dA-Za-z-]+\/(?:discs\/(?:vinyl|standard|parastais-dead)\/(?:all-discs|disc-\d{2,6})\/(?:artwork|burning(?:\/(?:image-burn|file-burn))?)|general\/(?:artwork|burning))\/[a-zA-Z0-9._-]{1,120}--[0-9a-f-]{36}$/.test(file.key) ||
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
      !ALLOWED_FILE_FIELDS.has(file.field) ||
      (file.product !== undefined && !["vinyl", "standard", "parastais-dead"].includes(file.product)) ||
      (file.diskNumber !== undefined && (!Number.isInteger(file.diskNumber) || file.diskNumber < 1 || file.diskNumber > 10000)) ||
      (file.scope !== undefined && !["all", "disk"].includes(file.scope)) ||
      (file.purpose !== undefined && !["artwork", "burning"].includes(file.purpose)) ||
      (file.burnType !== undefined && (!["image-burn", "file-burn"].includes(file.burnType) || file.purpose !== "burning")) ||
      (file.burnType === "image-burn" && (!file.contentType.startsWith("image/") || !file.key.includes("/burning/image-burn/"))) ||
      (file.burnType === "file-burn" && !file.key.includes("/burning/file-burn/"))
    ) {
      return false;
    }
    keys.add(file.key);
    return true;
  });
}

function filesMatchOrder(items, files) {
  const expectedFields = new Set();
  const optionFiles = {
    optionVinylSurface: [{ field: "artworkVinylSurface", product: "vinyl", purpose: "artwork" }],
    optionStandardSurface: [{ field: "artworkStandardSurface", product: "standard", purpose: "artwork" }],
    optionStandardPrintSurface: [{ field: "artworkStandardPrintSurface", product: "parastais-dead", purpose: "artwork" }],
    optionCasesFinish: [{ field: "artworkCaseFront" }, { field: "artworkCaseBack" }],
    optionVinylBurn: [{ field: "burningVinyl", legacyField: "burningVinyl", product: "vinyl", purpose: "burning", burnType: "file-burn" }],
    optionStandardBurn: [{ field: "burningStandard", legacyField: "burningStandard", product: "standard", purpose: "burning", burnType: "file-burn" }],
    optionStandardImageBurn: [
      { field: "burningStandardImage", legacyField: "burningStandard", product: "standard", purpose: "burning", burnType: "image-burn" },
    ],
  };
  const expectedFiles = [];

  for (const item of items) {
    for (const option of item.options) {
      for (const file of optionFiles[option] || []) {
        expectedFiles.push(file);
        expectedFields.add(file.field);
        if (file.legacyField) expectedFields.add(file.legacyField);
      }
    }
    if (["vinyl", "standard"].includes(item.product)) {
      const diskOptions = [
        ...expectedFiles.filter((file) => file.product === item.product),
      ];
      for (const expected of diskOptions) {
        const matches = files.filter((file) => (file.field === expected.field || file.field === expected.legacyField) &&
          file.product === expected.product &&
          file.purpose === expected.purpose && (file.burnType === expected.burnType ||
            (expected.legacyField === file.field && file.burnType === undefined)));
        if (item.discAssignment === "individual") {
          for (let disk = 1; disk <= item.quantity; disk += 1) {
            if (!matches.some((file) => file.scope === "disk" && file.diskNumber === disk)) return false;
          }
          if (matches.some((file) => file.scope !== "disk" || file.diskNumber > item.quantity)) return false;
        } else if (!matches.some((file) => file.scope === "all" && file.diskNumber === undefined)) {
          return false;
        }
      }
    } else if (item.product === "parastais-dead") {
      for (const expected of expectedFiles.filter((file) => file.product === item.product)) {
        const matches = files.filter((file) => file.field === expected.field && file.product === expected.product &&
          file.purpose === expected.purpose);
        if (!matches.some((file) => file.scope === "all" && file.diskNumber === undefined) ||
          matches.some((file) => file.scope !== "all" || file.diskNumber !== undefined)) return false;
      }
    }
  }

  return expectedFiles.every((expected) => files.some((file) =>
    (file.field === expected.field || file.field === expected.legacyField) &&
    (expected.product === undefined || file.product === expected.product) &&
    (expected.purpose === undefined || file.purpose === expected.purpose) &&
    (expected.burnType === undefined || file.burnType === expected.burnType ||
      (expected.legacyField === file.field && file.burnType === undefined)))) &&
    files.every((file) => expectedFields.has(file.field) && expectedFiles.some((expected) =>
      (file.field === expected.field || file.field === expected.legacyField) &&
      (expected.product === undefined || file.product === expected.product) &&
      (expected.purpose === undefined || file.purpose === expected.purpose) &&
      (expected.burnType === undefined || file.burnType === expected.burnType ||
        (expected.legacyField === file.field && file.burnType === undefined))));
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
    files: body.files.map(({ key, name, contentType, size, field, product, diskNumber, scope, purpose, burnType }) => ({
      key,
      name,
      contentType,
      size,
      field,
      ...(product ? { product } : {}),
      ...(diskNumber ? { diskNumber } : {}),
      ...(scope ? { scope } : {}),
      ...(purpose ? { purpose } : {}),
      ...(burnType ? { burnType } : {}),
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
        item.quantity > 100 ||
        !Array.isArray(item.options) ||
        new Set(item.options).size !== item.options.length ||
        item.options.some((option) => !Object.hasOwn(product.options, option)) ||
        (["vinyl", "standard"].includes(item.product) && !["same", "individual"].includes(item.discAssignment))
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
        ...(item.discAssignment ? { discAssignment: item.discAssignment } : {}),
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

        // Older cached Hosting pages may still call start-order without items.
        const orderSummary = body.items === undefined ? "Pasutijums" : toOrderSummary(body.items);
        if (!orderSummary) return res.status(400).json({ error: "Pasūtījuma produktu skaits nav derīgs." });
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

          const nextOrderNumber = `${nextSequence}-${nameSlug}-${orderSummary}`;
          transaction.set(sequenceRef, {
            lastSequence: nextSequence,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          transaction.create(db.collection("_orderReservations").doc(nextOrderNumber), {
            orderNumber: nextOrderNumber,
            nameSlug,
            orderSummary,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return nextOrderNumber;
        });

        return res.json({ orderNumber });
      }

      if (req.method === "POST" && path === "/get-upload-url") {
        const { orderNumber, fileName, fileType, fileSize, field, product, diskNumber, scope, purpose, burnType } = body || {};
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
          !ALLOWED_FILE_FIELDS.has(field) ||
          (product !== undefined && !["vinyl", "standard", "parastais-dead"].includes(product)) ||
          (diskNumber !== undefined && (!Number.isInteger(diskNumber) || diskNumber < 1 || diskNumber > 10000)) ||
          (scope !== undefined && !["all", "disk"].includes(scope)) ||
          (purpose !== undefined && !["artwork", "burning"].includes(purpose)) ||
          (burnType !== undefined && (!["image-burn", "file-burn"].includes(burnType) || purpose !== "burning")) ||
          (burnType === "image-burn" && !fileType.startsWith("image/")) ||
          (burnType === "image-burn" && (field !== "burningStandardImage" || product !== "standard")) ||
          (burnType === "file-burn" && !(
            (field === "burningVinyl" && product === "vinyl") ||
            (field === "burningStandard" && product === "standard")
          )) ||
          (product && purpose && !((purpose === "artwork" && field.startsWith("artwork")) || (purpose === "burning" && field.startsWith("burning"))))
        ) {
          return res.status(400).json({ error: "Faila informācija nav derīga." });
        }

        const safeFileName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
        if ((scope === "disk") !== Number.isInteger(diskNumber)) {
          return res.status(400).json({ error: "Norādītais diska numurs nav derīgs." });
        }
        const category = product
          ? `discs/${product}/${scope === "disk" ? `disc-${String(diskNumber).padStart(2, "0")}` : "all-discs"}/${purpose === "burning" ? `burning${burnType ? `/${burnType}` : ""}` : purpose || "artwork"}`
          : `general/${field.startsWith("burning") ? "burning" : "artwork"}`;
        const fileKey = `orders/${orderNumber}/${category}/${safeFileName}--${randomUUID()}`;

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          ContentType: fileType,
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
              (uploaded.ContentType && uploaded.ContentType !== file.contentType)
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
              (reservationSnapshot.get("orderSummary") !== "Pasutijums" &&
                reservationSnapshot.get("orderSummary") !== toOrderSummary(submission.items)) ||
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
