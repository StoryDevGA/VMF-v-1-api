// Server-selected inspection profile, not a review release or customer approval.
// These count guarded driver method entries, including internal delegations;
// they are not wire-query counts. Legacy readers retain their 10,000 cap.
export const APPROVED_DOCX_OPERATION_LIMITS = Object.freeze({
  APPROVED_CANDIDATE: Object.freeze({ methodCalls: 20000 }),
  APPROVED_REVIEW_PREPARATION: Object.freeze({ methodCalls: 50000, deadlineMs: 1200000 }),
  NARROW_CANDIDATE: Object.freeze({ methodCalls: 20000 }),
})
export const APPROVED_DOCX_READ_VERSION = 'CONTROLLED_DOCX_READ_V3'
export const APPROVED_DOCX_RESULT_VERSION = 'CONTROLLED_DOCX_READ_RESULT_V3'
export const APPROVED_DOCX_READ_SELECTION = Object.freeze({
  "candidateId": "docx_candidate_c396012f-ebf6-4da0-b4e8-71580a359024",
  "previewId": "docx_preview_49c7c65f-3d60-4a76-8a85-c5794567c2e1",
  "recorderUserId": "698b3800f83b3257365fd7a3"
})
export const APPROVED_DOCX_READ_HASHES = Object.freeze({
  "sourceFingerprint": "51cc8bf0b164db4e60438cb1559e62bf9a19b3cb2ebff4ffb0522f3ea57a9891",
  "inputFingerprint": "08376ccd64853915fe84247c673846fdc37e34077083d6de1631af0f80477321",
  "bodyFingerprint": "f95736f9cb07513613bc957aaa267678f0ec6135252fb2752f8b266b8046a1b5",
  "masterBindingFingerprint": "a8a37dbf3beddb3c7af7de1fc764a24af3aec91c4188d1176ca6b9fd6830fd4c",
  "outputChecksum": "sha256:3d97a836805e6602d32ae238084a12e883fb14ff8f7de53385d555fd9cdc366a"
})
export const APPROVED_DOCX_READ_PAGES = Object.freeze([
  {
    "number": 1,
    "width": 1275,
    "height": 1651,
    "byteLength": 351500,
    "sha256": "f294ee10bc17eb10bf53ccc46c61ee16db9e45bb21e9adc6738c6536fb40ff83"
  },
  {
    "number": 2,
    "width": 1275,
    "height": 1651,
    "byteLength": 384233,
    "sha256": "a0faf93c3981a122f7928f7eb0f87e98a6adc0059c852989be7a330198eb60db"
  },
  {
    "number": 3,
    "width": 1275,
    "height": 1651,
    "byteLength": 428082,
    "sha256": "0cb268c209cf00781d56e52ce34548962b155034f8429fb32f91e9cc2d154c02"
  },
  {
    "number": 4,
    "width": 1275,
    "height": 1651,
    "byteLength": 423249,
    "sha256": "b80bc87db37983f8e0a223e4b45247ab29a5eea72e1b6d704caa3b8cef04049c"
  },
  {
    "number": 5,
    "width": 1275,
    "height": 1651,
    "byteLength": 418525,
    "sha256": "d84706799cbe9fde17f1c9b7ad98a3a03db1efc63e247c2d977853b03559f7f7"
  },
  {
    "number": 6,
    "width": 1275,
    "height": 1651,
    "byteLength": 433716,
    "sha256": "41b17c9ed4e0b18ec965007727f4ed6a6fa18641e76179d33b08cf56d48a1e98"
  },
  {
    "number": 7,
    "width": 1275,
    "height": 1651,
    "byteLength": 513586,
    "sha256": "a1d6d99978da4f7f32a9db240144ad580375361fc0c7820f88687774b1228e45"
  }
].map(page => Object.freeze(page)))

// Separately selected saved correction; no new review or approval authority.
export const NARROW_DOCX_READ_VERSION = 'CONTROLLED_DOCX_READ_V4'
export const NARROW_DOCX_RESULT_VERSION = 'CONTROLLED_DOCX_READ_RESULT_V4'
export const NARROW_DOCX_READ_SELECTION = Object.freeze({
  candidateId: 'docx_candidate_f032af3b-ad37-492a-ab38-9abbc7d4caeb',
  previewId: 'docx_preview_8e2359c4-eafb-4c4f-bc39-05d081e68dd2',
  recorderUserId: '698b3800f83b3257365fd7a3',
})
export const NARROW_DOCX_READ_HASHES = Object.freeze({
  sourceFingerprint: '51cc8bf0b164db4e60438cb1559e62bf9a19b3cb2ebff4ffb0522f3ea57a9891',
  inputFingerprint: '685261ae0e443e30032cf943195045fe2fe91ceffd8652389037a7f5f1523d0d',
  bodyFingerprint: 'ffbc3bdf8d5efb05d66239287dc8c2102b366a986fe8f93f3b0445a3d5484f30',
  masterBindingFingerprint: 'da7485943665ddd05299dac308f9e3fbae9e71402e492a37fcc9e1f87c9a9746',
  outputChecksum: 'sha256:79525d457a1f5deb0460ac3dfcf6731d60b65c0e18ae433e7685661c947909f5',
})
export const NARROW_DOCX_READ_PREVIEW_HASHES = Object.freeze({
  conversionFingerprint: 'd84fa41fa7679c0a10d2356b94392c1b938793cda36f6a166d681c82edf9eb61',
  runtimeFingerprint: '96cd2fbf9fe13151d7f2cc05965e3e71ea339fb633cd24880f2cb4decee5d8a9',
})
export const NARROW_DOCX_READ_PAGES = Object.freeze([
  { number: 1, width: 1275, height: 1651, byteLength: 344421,
    sha256: 'e6a5eaf74fc1686b72a1c7ff0d2bdd457814de00a5a1baa166352aec2b21847b' },
  { number: 2, width: 1275, height: 1651, byteLength: 401293,
    sha256: '7c6033c6f7aae9ce19e3f40b5b802bfb150ed4f22534957022e37cbe5b70ff1a' },
  { number: 3, width: 1275, height: 1651, byteLength: 388118,
    sha256: '1f81e59a08d99418eed405feda41a82d9e53b104f5ce527455662a5eb4410353' },
  { number: 4, width: 1275, height: 1651, byteLength: 340137,
    sha256: 'e1845acde655e01ea59b1f30e667fdb2facc04510b80e675c7b5820052f0b614' },
  { number: 5, width: 1275, height: 1651, byteLength: 415219,
    sha256: 'cbc3a1be1b7002f307ac5f524f1a86d0e260c0614dd2c3339c5f05cb283f25b0' },
  { number: 6, width: 1275, height: 1651, byteLength: 429214,
    sha256: 'b352274946ab406d935c6b255a00293f553d5c1d89287297431a54bd2ea4d3f6' },
  { number: 7, width: 1275, height: 1651, byteLength: 366313,
    sha256: 'a5c7d97f10ee3f9017651b743700bfa6c2c8f214a9ec1906b22e017a468c8308' },
].map(page => Object.freeze(page)))
