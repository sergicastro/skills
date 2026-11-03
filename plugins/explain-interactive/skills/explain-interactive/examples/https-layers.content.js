/* Content file for a "concept" page: what HTTPS is made of, one layer at a time.
   Build it with:  node build.mjs examples/https-layers.content.js -o ~/explanations/https-layers.html
   Field reference: SKILL.md ("Page types"). */

const META = {
  type: "concept",
  title: "What HTTPS is made of",
  bigPicture: "HTTPS is four layers stacked on each other: IP moves packets, TCP makes them a reliable stream, TLS makes the stream private, and HTTP is the request inside.",
};

const GLOSSARY = {
  "packet": "A small chunk of data with a destination address on it; the network moves each one on its own.",
  "port": "A number that picks which program on a machine gets the data; HTTPS uses 443.",
  "certificate": "A file that ties a domain name to a public key, signed by an authority the browser trusts.",
  "handshake": "The first messages two sides exchange to agree on how they will talk before any real data is sent.",
};

/* The layers, foundation first: LAYERS[0] is drawn at the bottom of the stack. Each step adds one (step.layer). */
const LAYERS = [
  { id: "ip", name: "IP", text: "Moves packets from one address to another, with no promise they arrive." },
  { id: "tcp", name: "TCP", text: "Numbers the packets and resends lost ones, so both ends see one ordered stream." },
  { id: "tls", name: "TLS", text: "Encrypts the stream and proves the server owns the domain." },
  { id: "http", name: "HTTP", text: "The request and the reply: GET /cart, headers, a body." },
];

const STEPS = [
  {
    title: "What we're building up",
    summary: "one HTTPS request, layer by layer",
    context: {
      question: "What actually happens under <code>https://shop.example/cart</code>, and why is it four separate things?",
      setting: "A browser on a laptop and a web server somewhere on the internet.",
      why: "Most connection errors (timeouts, reset connections, certificate warnings) belong to one layer; knowing which saves a lot of guessing.",
      prereqs: [],
      example: "The browser loads <code>https://shop.example/cart</code>.",
    },
    body: `<p>Each step adds one layer on top of the last, starting from the bottom.</p>`,
  },
  {
    title: "IP moves packets",
    summary: "addresses, no guarantees",
    layer: "ip",
    body: `<p>Everything the browser sends to <code>shop.example</code> is cut into <dfn data-term="packet">packets</dfn>, each addressed to the server's IP address. <mark>IP</mark> delivers each one on its own, <strong>but it may lose some or deliver them out of order</strong>. That is why it is not enough alone.</p>`,
  },
  {
    title: "TCP makes a reliable stream",
    summary: "ordered, resent, on port 443",
    layer: "tcp",
    body: `<p>On top of IP, <mark>TCP</mark> numbers every packet and resends any that go missing. The browser and the server now see <strong>one ordered stream of bytes</strong>, on <dfn>port</dfn> 443. A timeout while connecting is a problem here or below.</p>`,
    quiz: {
      q: "One packet of the reply is lost on the way to the browser. What does the browser's code see?",
      options: [
        "Nothing unusual; TCP resends it and the stream arrives complete",
        { t: "A page with a hole in it", why: "TCP does not pass data on with a gap; it waits for the missing packet first." },
        { t: "A certificate error", why: "Certificates belong to TLS, a layer above; a lost packet never reaches it as an error." },
      ],
      answer: 0,
      why: "Loss is handled inside TCP. The layers above only notice it as a short delay.",
    },
  },
  {
    title: "TLS makes it private",
    summary: "encrypted, and the server is checked",
    layer: "tls",
    body: `<p>Before any request is sent, <mark>TLS</mark> runs a <dfn>handshake</dfn> over the TCP stream: the server shows a <dfn>certificate</dfn> for <code>shop.example</code>, and both sides agree on a key. <strong>From then on everything in the stream is encrypted.</strong> A certificate warning comes from this layer.</p>`,
  },
  {
    title: "HTTP is the request itself",
    summary: "GET /cart, inside TLS",
    layer: "http",
    body: `<p>Only now does the browser send <code>GET /cart</code>. <mark>HTTP</mark> is just text with headers and a body; <strong>the layers below carry it without reading it</strong>. A 404 or a 500 is an answer at this layer, so everything below worked.</p>`,
    code: `GET /cart HTTP/1.1
Host: shop.example
Cookie: session=…`,
  },
  {
    title: "Recap",
    body: `<p>Read the stack from the bottom: IP moves <dfn data-term="packet">packets</dfn>, TCP makes them a stream, TLS makes the stream private, and HTTP rides inside it. An error belongs to the lowest layer that failed.</p>`,
  },
];
