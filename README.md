# CDify

CDify vietne tiek publicēta Firebase Hosting un izmanto pasūtījuma formu, Firebase Cloud Functions, Firestore un Cloudflare R2. Esošais formas izkārtojums un pārlūka validācija ir saglabāti.

## Datu plūsma

- Formas teksts un pasūtījuma metadati tiek sūtīti uz tās pašas Firebase Hosting izcelsmes `/api` adresi, pārbaudīti `api` Cloud Function un saglabāti Firestore kolekcijā `orders`.
- Jaunā pasūtījuma Firestore dokumenta ID un R2 saknes mape ir viens un tas pats lasāmais nosaukums: `<kārtas-numurs>-<klienta-vārds>-<produktu-veidi-un-skaits>`, piemēram, `106-Janina-Vinila-2-Parastie-1`. Kārtas numurs garantē unikalitāti; UUID pasūtījuma nosaukumā vairs nav.
- Atlasītie faili tiek augšupielādēti tieši R2 bucketā `r2cdify`, izmantojot īslaicīgas parakstītas saites ar path-style URL. Firestore glabā failu atslēgas un metadatus, nevis failu saturu. R2 objektu ceļi ir sakārtoti kā `orders/<pasūtījuma-numurs>/discs/<veids>/<all-discs-vai-disc-NN>/<artwork-vai-burning>/<faila-nosaukums>--<unikāls-ID>`.
- `firestore.rules` liedz vietnei tiešu piekļuvi Firestore; Cloud Function datubāzē raksta ar Firebase Admin SDK.
- Formā redzamā kopsumma ir aptuvena; funkcija to aprēķina no iesniegtajiem produktiem un opcijām.

## Konfigurēšana un publicēšana

1. Nomaini visus Cloudflare API tokenus un R2 piekļuves atslēgas, kas tika kopīgotas. Izveido atsevišķu R2 S3 piekļuves atslēgu ar piekļuvi tikai `r2cdify` bucketam.
2. Cloudflare bucketam iestati CORS: vietnes izcelsmes adreses, `PUT` metode un pieprasījuma galvenes. CORS ir obligāts, jo pārlūks augšupielādē failus tieši R2. Augšupielādes pieprasījumā vairs netiek sūtītas pielāgotas `x-amz-meta-*` galvenes; tas novērš biežu preflight noraidījumu. Iestati:

   ```json
   [
     {
       "AllowedOrigins": [
         "https://cdify-smu.web.app",
         "https://cdify-smu.firebaseapp.com",
         "https://cdify.xyz"
       ],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Pievieno arī citas produkcijas vai priekšskatījuma vietnes adreses, ja tās izmanto formu. Pēc CORS maiņas izmēģini formu no tās pašas vietnes adreses; vecam parakstītam URL var būt beidzies derīgums.
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
