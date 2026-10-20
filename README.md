# CDify

CDify vietne tiek publicēta Firebase Hosting un izmanto pasūtījuma formu, Firebase Cloud Functions, Firestore un Cloudflare R2. Esošais formas izkārtojums un pārlūka validācija ir saglabāti.

## Datu plūsma

- Formas teksts un pasūtījuma metadati tiek sūtīti uz tās pašas Firebase Hosting izcelsmes `/api` adresi, pārbaudīti `api` Cloud Function un saglabāti Firestore kolekcijā `orders`.
- Atlasītie faili tiek augšupielādēti tieši R2 bucketā `r2cdify`, izmantojot īslaicīgas parakstītas saites. Firestore glabā failu atslēgas un metadatus, nevis failu saturu.
- `firestore.rules` liedz vietnei tiešu piekļuvi Firestore; Cloud Function datubāzē raksta ar Firebase Admin SDK.
- Formā redzamā kopsumma ir aptuvena; funkcija to aprēķina no iesniegtajiem produktiem un opcijām.

## Konfigurēšana un publicēšana

1. Nomaini visus Cloudflare API tokenus un R2 piekļuves atslēgas, kas tika kopīgotas. Izveido atsevišķu R2 S3 piekļuves atslēgu ar piekļuvi tikai `r2cdify` bucketam.
2. Cloudflare bucketam iestati CORS: vietnes izcelsmes adreses, `PUT` metode un `Content-Type` galvene. Formas faili tiek augšupielādēti tieši R2, tāpēc bucket CORS konfigurācija ir obligāta. Pašlaik konfigurētajām vietnes adresēm to var iestatīt šādi:

   ```json
   [
     {
       "AllowedOrigins": [
         "https://cdify-smu.web.app",
         "https://cdify-smu.firebaseapp.com",
         "https://home.jalatvia.lv"
       ],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": [
         "Content-Type",
         "x-amz-checksum-crc32",
         "x-amz-sdk-checksum-algorithm"
       ],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Pievieno arī citas produkcijas vai priekšskatījuma vietnes adreses, ja tās izmanto formu.
3. Failā `functions/.env.cdify-smu` norādi publiskās konfigurācijas vērtības:

   ```dotenv
   R2_ACCOUNT_ID=your_cloudflare_account_id
   R2_BUCKET_NAME=r2cdify
   R2_PUBLIC_DOMAIN=
   ```

   `R2_PUBLIC_DOMAIN` nav obligāts. Ja tas nav iestatīts, augšupielādētie objekti paliek privāti, un metadatos tiek saglabātas tikai R2 objektu atslēgas.
4. Nomainītās piekļuves atslēgas iestati kā Firebase Functions noslēpumus. Izpildi komandas un ievadi vērtības drošajā uzvednē; neglabā piekļuves datus koda vai `.env` failos:

   ```powershell
   npx firebase-tools functions:secrets:set R2_ACCESS_KEY_ID
   npx firebase-tools functions:secrets:set R2_SECRET_ACCESS_KEY
   ```

5. Instalē Functions atkarības, pēc tam publicē Firestore noteikumus, funkciju un vietni:

   ```powershell
   cd functions
   npm install
   cd ..
   npx firebase-tools deploy --only firestore:rules,functions,hosting
   ```

API funkcija tiek publicēta reģionā `europe-west1`, blakus Firestore datubāzei. Pirms vietnes plašas publicēšanas izvieto Firestore noteikumus; tie liedz vietnei tiešu piekļuvi, bet Admin SDK funkcija joprojām var saglabāt iesniegumus.
