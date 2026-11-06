/* explain-interactive content: what happens when the mobile app retries POST /payments in acme/shop-api. */

const META = {
  title: "What happens when the app retries a payment",
  bigPicture: "create_payment() remembers each Idempotency-Key in the idempotency_keys table, so a retry of the same payment is answered from that row instead of charging the card again, for 24 hours.",
};

const CAST = {
  // added to the saved run's output so every listed name has an entry
  "POST /payments": "The endpoint the app calls to pay.",
  "acme/shop-api": "The backend repository that serves the shop's HTTP API, including POST /payments.",
  "create_payment()": "The handler in acme/shop-api that runs for every POST /payments request.",
  "idempotency_keys": "A database table with one row per Idempotency-Key: its status (pending or done) and, once done, the stored provider response.",
  "Payment provider": "The outside service that actually charges the card. Calling it is the step that costs the customer money.",
  "Mobile app": "The shop's app on the customer's phone; it sends POST /payments and may retry it.",
};

const GLOSSARY = {
  "Idempotency-Key": "A request header holding a unique id for one payment attempt. Sending the same key again means \"this is the same payment, not a new one\".",
  "idempotent": "Safe to repeat: doing it twice has the same effect as doing it once.",
  "retry": "Sending the same request again because the first one seemed to fail, for example it timed out.",
  "pending": "Row status meaning: a request with this key has started and is still talking to the provider.",
  "done": "Row status meaning: the provider has answered and its response is saved on the row.",
  "409 Conflict": "An HTTP error status. Here it means \"a request with this key is still running; try again later\".",
};

const DIAGRAM = {
  layout: "sequence",
  label: "The mobile app calls create_payment(), which checks idempotency_keys and only calls the payment provider when the key is new",
  nodes: [
    { id: "app", label: "Mobile app" },
    { id: "api", label: "create_payment()" },
    { id: "db", label: "idempotency_keys" },
    { id: "prov", label: "Payment provider" },
  ],
  edges: [
    { id: "req", from: "app", to: "api", label: "POST /payments key=k-7f3a" },
    { id: "lookup", from: "api", to: "db", label: "look up k-7f3a" },
    { id: "none", from: "db", to: "api", label: "no row" },
    { id: "pendingrow", from: "db", to: "api", label: "row: pending", kind: "bad" },
    { id: "donerow", from: "db", to: "api", label: "row: done + response", kind: "ok" },
    { id: "insert", from: "api", to: "db", label: "insert k-7f3a pending" },
    { id: "charge", from: "api", to: "prov", label: "charge €20" },
    { id: "provresp", from: "prov", to: "api", label: "charged" },
    { id: "store", from: "api", to: "db", label: "save response, done" },
    { id: "ok", from: "api", to: "app", label: "provider response", kind: "ok" },
    { id: "conflict", from: "api", to: "app", label: "409 Conflict", kind: "bad" },
    { id: "replay", from: "api", to: "app", label: "stored response", kind: "ok" },
  ],
};

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "why a retry doesn't charge twice",
    context: {
      question: "When the <dfn>Mobile app</dfn> sends a payment again, does the customer get charged again, and what answer does the app get?",
      setting: "In <dfn>acme/shop-api</dfn>, the handler <dfn>create_payment()</dfn> serves <code>POST /payments</code>. It keeps a table, <dfn>idempotency_keys</dfn>, and calls the <dfn>Payment provider</dfn> to charge the card.",
      why: "Phones lose signal mid-request: the app may never see the answer to a charge that did happen. If it just sends the payment again, the customer could pay twice.",
      prereqs: [
        "<dfn>Idempotency-Key</dfn>: a header with a unique id for one payment; the same id on a resend means \"same payment\".",
        "A <dfn>retry</dfn> is the app sending the same request again because the first seemed to fail.",
      ],
      example: "The customer taps Pay for €20. The app sends <code>POST /payments</code> with key <code>k-7f3a</code> (example values), and the table has no row for <code>k-7f3a</code> yet.",
    },
    body: `<p>The next steps follow that one €20 payment through its first try, and then let you flip between the ways a retry can arrive.</p>`,
    diagram: {},
  },
  {
    title: "The app sends the key",
    summary: "every request carries Idempotency-Key k-7f3a",
    body: `<p>Our payment starts with the <dfn>Mobile app</dfn> sending <mark>POST /payments key=k-7f3a</mark>. <strong>The key names the payment, not the request</strong>: a retry of the same payment must carry the same <code>k-7f3a</code>, or the server sees a brand-new payment. That is the whole trick the next steps rely on.</p>`,
    diagram: { hl: ["app", "req"] },
    deeper: `<p>The explanation this page is based on doesn't say how the app makes its keys. The usual pattern, assumed here, is: create a random key when the customer taps Pay, keep it while retrying that payment, and make a new one only for a new payment.</p><p>Also not covered by the source: what the handler does with a request that has no key, or one that reuses a key with a different amount. Check <code>create_payment()</code> before relying on either.</p>`,
  },
  {
    title: "First, look the key up",
    summary: "the table is checked before anything else",
    body: `<p>Before doing anything that costs money, <dfn>create_payment()</dfn> runs <mark>look up k-7f3a</mark> in <dfn>idempotency_keys</dfn>. <strong>The row's state decides everything that follows</strong>: there can be no row, a <dfn>pending</dfn> row, or a <dfn>done</dfn> row. On our first try there is <mark>no row</mark>.</p>`,
    diagram: { hl: ["api", "lookup", "none"] },
  },
  {
    title: "Claim the key as pending",
    summary: "a pending row is written before charging",
    body: `<p>With no row found, the handler first does <mark>insert k-7f3a pending</mark> and only then talks to the provider. <strong>The row is written before the charge</strong> so that any second request with the same key, even one arriving a split second later, finds it and doesn't charge too.</p>`,
    diagram: { hl: ["db", "insert"] },
    quiz: {
      q: "Suppose create_payment() charged the card first and only wrote the row afterwards. A retry arrives while the charge is running. What happens?",
      options: [
        "The retry finds no row and charges €20 a second time",
        { t: "The retry gets 409 Conflict", why: "409 comes from finding a pending row, and in this version no row exists yet." },
        { t: "The retry gets the stored response", why: "Nothing is stored yet: the first charge hasn't finished." },
      ],
      answer: 0,
      why: "Writing the pending row first is what makes an in-flight retry visible. Without it, the gap between charging and writing is exactly where a double charge slips in.",
    },
    deeper: `<p>A gap remains between the lookup and the insert: two requests arriving at the same instant could both see \"no row\". That is normally closed by making the key unique in the table, so the second insert fails. The explanation this page is based on doesn't say whether <code>idempotency_keys</code> does this; it is an assumption to verify in the code.</p>`,
  },
  {
    title: "Charge, save, answer",
    summary: "the response is saved on the row",
    body: `<p>Now the handler sends <mark>charge €20</mark> to the <dfn>Payment provider</dfn> and gets its answer back. It does <mark>save response, done</mark> on the <code>k-7f3a</code> row, then returns the <mark>provider response</mark> to the app. <strong>Saving the response is what lets a later retry get the same answer</strong> without asking the provider again. Press Next to see the messages in order.</p>`,
    diagram: { hl: ["prov", "charge", "provresp"], build: [["charge", "provresp"], "store", "ok"] },
    deeper: `<p>This page shows the charge succeeding. The source explanation doesn't say what happens when the provider declines the card or errors: whether that answer is also saved as done (and replayed to every retry) or the row is cleared so a retry can try again. Check the code for that case.</p>`,
  },
  {
    title: "The three ways a request arrives",
    summary: "no row, pending or done",
    body: `<p>Now send the same <code>k-7f3a</code> again. The lookup from earlier has three possible results, and each leads somewhere different. <strong>Only \"no row\" ever reaches the provider.</strong> Switch between the cases and watch which arrows light up.</p>`,
    whatif: {
      label: "the request is the…",
      options: [
        { id: "first", label: "first try", diagram: { hl: ["none", "charge", "ok"] },
          outcome: `The lookup finds <mark>no row</mark>, so the handler inserts it as pending, does the <mark>charge €20</mark> and returns the <mark>provider response</mark>. One charge.` },
        { id: "while-running", label: "retry while the first is still running", diagram: { hl: ["pendingrow", "conflict"], dim: ["insert", "charge", "provresp", "store", "ok", "replay"] },
          outcome: `The lookup finds a <mark>row: pending</mark>: the first try is still waiting on the provider. The handler answers <mark>409 Conflict</mark> and charges nothing; the app should wait and retry.` },
        { id: "after-finished", label: "retry after it finished", diagram: { hl: ["donerow", "replay"], dim: ["insert", "charge", "provresp", "store", "ok", "conflict"] },
          outcome: `The lookup finds a <mark>row: done + response</mark>. The handler returns that <mark>stored response</mark>, the same answer the first try got, without calling the provider: still one charge.` },
      ],
    },
    quiz: {
      q: "The app's first try timed out on the phone, but the server kept going. The app retries, gets 409, waits 5 seconds and retries again. The first try has finished by then. What does the second retry get?",
      options: [
        "The stored response from the first charge",
        { t: "Another 409 Conflict", why: "409 is only for a pending row. Once the first try finished, the row is done." },
        { t: "A new charge of €20", why: "A new charge needs \"no row\"; the row for k-7f3a exists and is done." },
        { t: "An error saying the payment already exists", why: "A done row is answered with the saved response, not an error." },
      ],
      answer: 0,
      why: "409 just means \"not finished yet\". Once the row is done, every retry with that key gets the same saved answer: the customer is charged once and the app finally learns the result.",
    },
    deeper: `<p>From the app's side, the timeout and the 409 look like failures, but neither one means the payment failed. Only the provider response (first try, or replayed) says whether the charge went through.</p><p>The source explanation doesn't say what happens if the first request crashes after writing pending, so its row never becomes done. From the rules as described, retries would keep getting 409 until the row expires; check the code before relying on that.</p>`,
  },
  {
    title: "After 24 hours, keys are forgotten",
    summary: "an expired row means a new charge",
    body: `<p>Rows in <dfn>idempotency_keys</dfn> expire after 24 hours. <strong>Once the row is gone, a retry looks exactly like a first try</strong>, so it charges again. Move the slider to change when the retry arrives after the first try.</p>`,
    whatif: {
      label: "the retry with k-7f3a arrives…",
      control: "slider",
      options: [
        { id: "2min", label: "2 minutes later", diagram: { hl: ["donerow", "replay"], dim: ["none", "charge"] },
          outcome: `The row is still there and done: the app gets the <mark>stored response</mark>, no new charge.` },
        { id: "23h", label: "23 hours later", diagram: { hl: ["donerow", "replay"], dim: ["none", "charge"] },
          outcome: `Still inside the 24 hours: same <mark>stored response</mark>, no new charge.` },
        { id: "25h", label: "25 hours later", diagram: { hl: ["none", "charge"], dim: ["donerow", "replay"] },
          outcome: `The row has expired, so the lookup finds <mark>no row</mark> and the handler does a second <mark>charge €20</mark>.` },
      ],
    },
    quiz: {
      q: "The app has a bug and retries an old payment 2 days later with the same key k-7f3a. What happens?",
      options: [
        "The customer is charged €20 again",
        { t: "The app gets the stored response", why: "The stored response lived on the row, and the row expired after 24 hours." },
        { t: "The app gets 409 Conflict", why: "409 needs a pending row; after 24 hours there is no row at all." },
      ],
      answer: 0,
      why: "The protection lasts only as long as the row: 24 hours. After that the same key is treated as new, so retries must happen within that window.",
    },
    deeper: `<p>Not stated in the source: whether the 24 hours count from when the row was inserted as pending or from when it became done (minutes apart in practice), and whether a row stuck in pending expires on the same clock. The practical rule for the app is the same either way: retry within hours, not days, and use a fresh key for a genuinely new payment.</p>`,
  },
  {
    title: "Recap",
    body: `<p><dfn>create_payment()</dfn> charges only when <dfn>idempotency_keys</dfn> has no row for the key: a pending row gets <code>409</code>, a done row gets the saved answer, and after 24 hours the key is new again.</p>`,
    diagram: {},
  },
];
