/* Content file for a "before-after" page: what changes when a Go service's Dockerfile becomes a multi-stage build.
   Build it with:  node build.mjs examples/multistage-build.content.js -o ~/explanations/multistage-build.html
   Field reference: SKILL.md ("Page types"). */

const META = {
  type: "before-after",
  title: "Splitting the Dockerfile into two stages",
  bigPicture: "Building in one stage and running in another keeps the compiler out of the image that ships, so the image shrinks and has less to patch.",
  before: "One stage: the image that runs <code>api</code> also holds the Go toolchain and the source.",
  after: "Two stages: the first compiles, the second holds only the binary.",
};

const CAST = {
  "api": "The Go service in this example; it compiles to a single binary.",
};

const GLOSSARY = {
  "stage": "One <code>FROM</code> section of a Dockerfile. Each stage starts from its own base image; only the last one becomes the image you run.",
  "base image": "The image a stage starts from, named after <code>FROM</code>.",
  "static binary": "A program file that needs no shared libraries from the system it runs on.",
};

/* Each step's diff: { label, before, after }. The engine works out which lines changed. */
const STEPS = [
  {
    title: "What we're comparing",
    summary: "the api image, before and after",
    context: {
      question: "What changes in the <dfn>api</dfn> image when its Dockerfile is split into two <dfn data-term=\"stage\">stages</dfn>?",
      setting: "The Dockerfile sits at the root of the <dfn>api</dfn> repository and is built in CI on every merge.",
      why: "The single-stage image ships the whole Go toolchain, so it is large and every compiler vulnerability is also a vulnerability of the service.",
      prereqs: ["<dfn>stage</dfn>: a Dockerfile can have several <code>FROM</code> sections; only the last one is shipped."],
      example: "The Dockerfile below, which builds <code>api</code> with <code>golang:1.23</code>.",
    },
    body: `<p>The next steps change the file one piece at a time and say why each piece moves.</p>`,
    code: `# Dockerfile, as it is today
FROM golang:1.23
WORKDIR /src
COPY . .
RUN go build -o /bin/api ./cmd/api
CMD ["/bin/api"]`,
  },
  {
    title: "Name the build stage",
    summary: "the first FROM becomes 'build'",
    body: `<p>The first change only names the existing stage <code>build</code>. Nothing about the image changes yet; <strong>a name lets a later stage copy files out of this one</strong>.</p>`,
    diff: {
      label: "Dockerfile",
      before: `FROM golang:1.23
WORKDIR /src`,
      after: `FROM golang:1.23 AS build
WORKDIR /src`,
    },
  },
  {
    title: "Build a static binary",
    summary: "CGO off, so no C libraries",
    body: `<p>The final image will not have the C libraries the toolchain image has. Turning off cgo makes Go produce a <dfn>static binary</dfn>, <strong>so the binary runs on a base image with nothing else in it</strong>.</p>`,
    diff: {
      label: "Dockerfile",
      before: `COPY . .
RUN go build -o /bin/api ./cmd/api`,
      after: `COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api`,
    },
    quiz: {
      q: "What happens if the binary is built with cgo on and copied into an image that has no C library?",
      options: [
        "It fails to start: the libraries it links are missing",
        { t: "It runs, a little slower", why: "A missing shared library stops the program from starting at all; it does not fall back." },
        { t: "The build fails", why: "The build stage has the libraries, so the build succeeds; the failure only shows when the final image runs." },
      ],
      answer: 0,
      why: "A binary built with cgo looks for shared C libraries when it starts; in an empty image they are not there.",
    },
  },
  {
    title: "Add a stage that only runs",
    summary: "a second FROM holds the binary",
    body: `<p>The last lines start a second <dfn>stage</dfn> from <code>distroless/static</code>, a <dfn>base image</dfn> with no shell and no package manager. <code>COPY --from=build</code> takes just the binary from the first stage. <strong>Only this stage is shipped</strong>, so the toolchain and the source stay behind.</p>`,
    quiz: {
      q: "After the change, someone runs docker exec -it api sh to look around the running container. What happens?",
      options: [
        "It fails: the shipped image has no shell",
        { t: "It opens a shell from the build stage", why: "Only the last stage is shipped; the build stage and everything in it stay behind." },
        { t: "It works; distroless only drops the package manager", why: "distroless/static has no shell either." },
      ],
      answer: 0,
      why: "The shipped image is the second stage: distroless/static plus the binary, with no shell to start.",
    },
    diff: {
      label: "Dockerfile",
      before: `FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api
CMD ["/bin/api"]`,
      after: `FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api

FROM gcr.io/distroless/static
COPY --from=build /bin/api /bin/api
CMD ["/bin/api"]`,
    },
    deeper: `<p>There is no shell in the final image, so <code>docker exec … sh</code> no longer works for debugging. Use <code>kubectl debug</code> with an ephemeral container, or build a <code>:debug</code> variant of the base image when you need one.</p>`,
  },
  {
    title: "Recap",
    body: `<p>The whole change: name the first <dfn>stage</dfn>, build a <dfn>static binary</dfn>, and ship it from a second, almost empty stage.</p>`,
    diff: {
      label: "Dockerfile",
      before: `FROM golang:1.23
WORKDIR /src
COPY . .
RUN go build -o /bin/api ./cmd/api
CMD ["/bin/api"]`,
      after: `FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api

FROM gcr.io/distroless/static
COPY --from=build /bin/api /bin/api
CMD ["/bin/api"]`,
    },
  },
];
