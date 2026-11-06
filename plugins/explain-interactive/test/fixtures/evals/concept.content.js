/* Content file for a "concept" page: Python virtual environments, explained from npm and node_modules. */

const META = {
  type: "concept",
  title: "Python virtual environments, for npm users",
  bigPicture: "Python has no per-project node_modules by default, so a virtual environment makes one: a folder with its own package directory and its own python command, which you switch to before installing or running anything.",
};

const CAST = {
  // added to the saved run's output so every listed name has an entry
  "bin/python": "The venv's python: a link back to the real interpreter.",
  "requirements.txt": "The list of packages to install, like package.json.",
  "my-app": "The example project on this page: a small Python script, <code>app.py</code>, that needs the <code>requests</code> package.",
  "requests": "A popular Python package for making HTTP calls, roughly Python's <code>axios</code>. Used here as the package we install.",
  ".venv": "The folder the virtual environment lives in, inside <code>my-app</code>. The name is a convention, like <code>node_modules</code>.",
};

const GLOSSARY = {
  "interpreter": "The program that runs Python code: the <code>python</code> (or <code>python3</code>) command. It plays the role <code>node</code> plays for JavaScript.",
  "site-packages": "The folder where installed Python packages go. Python's equivalent of <code>node_modules</code>, but by default there is one per Python install, not one per project.",
  "pip": "Python's package installer, the equivalent of <code>npm install</code>. It downloads packages from PyPI, Python's npm registry.",
  "PATH": "An environment variable listing folders your shell searches, in order, when you type a command like <code>python</code>. The first folder that has a matching file wins.",
  "sys.path": "The list of folders Python searches when your code says <code>import something</code>. Print it with <code>python -c \"import sys; print(sys.path)\"</code>.",
  "sys.prefix": "A value inside Python saying which installation (or virtual environment) is running. Python builds <code>sys.path</code> from it.",
  "symlink": "A file that just points at another file, like a shortcut. Running it runs the file it points to.",
  "activate": "Running <code>source .venv/bin/activate</code> in a terminal so that <code>python</code> and <code>pip</code> mean the copies in <code>.venv</code> until you run <code>deactivate</code> or close the terminal.",
};

/* Foundation first: LAYERS[0] is drawn at the bottom. */
const LAYERS = [
  { id: "interp", name: "The interpreter", text: "One python program on your machine, like one node binary." },
  { id: "global", name: "One shared package folder", text: "Each Python install has one site-packages; imports only look there." },
  { id: "venv", name: "A .venv folder", text: "Its own site-packages, plus a python that points back at the real one." },
  { id: "prefix", name: "Python knows where it runs from", text: "Launched from .venv, python finds pyvenv.cfg and uses .venv's site-packages." },
  { id: "activate", name: "Activation", text: "Puts .venv/bin first on PATH, so python and pip mean the venv's copies." },
  { id: "reqs", name: "requirements.txt", text: "The package.json of the venv: commit it, not the .venv folder." },
];

const STEPS = [
  {
    title: "What we're building up",
    summary: "a per-project package folder for Python",
    context: {
      question: "What is a Python virtual environment, and why does every Python project tell you to make one before <code>pip install</code>?",
      setting: "Your laptop with Python installed, and one Python project, <dfn>my-app</dfn>, that needs one package, <dfn>requests</dfn>.",
      why: "Without one, every project on the machine shares one package folder, so two projects needing different versions of the same package break each other.",
      prereqs: [
        "<code>npm install</code> puts packages in <code>./node_modules</code>, next to <code>package.json</code>.",
        "Node finds <code>require('axios')</code> by looking in <code>node_modules</code> folders, starting from your file's folder and walking up.",
      ],
      example: "In <code>my-app</code> you run <code>python -m venv .venv</code>, then <code>pip install requests</code>, then <code>app.py</code>, which does <code>import requests</code>.",
    },
    body: `<p>Each step adds one piece, starting from what Python does with no virtual environment at all, and compares it with what npm does for you.</p>`,
  },
  {
    title: "Python is a program, like node",
    summary: "one python binary runs your code",
    layer: "interp",
    depth: "full",
    body: `<p>When you type <code>python app.py</code> in <code>my-app</code>, your shell finds a program called <code>python</code> and hands it the file. That program is the <dfn>interpreter</dfn>, the exact counterpart of the <code>node</code> binary. <strong>It lives in one place on the machine</strong>, for example <code>/usr/bin/python3</code>, and every project runs the same one.</p>`,
    analogy: "<code>python app.py</code> is <code>node app.js</code>: one installed program, shared by all your projects.",
  },
  {
    title: "Packages go to one shared folder",
    summary: "no node_modules: one site-packages per install",
    layer: "global",
    body: `<p>Now <code>my-app</code> needs <dfn>requests</dfn>. A plain <code>pip install requests</code> makes <dfn>pip</dfn> put it in the interpreter's <dfn>site-packages</dfn>, a machine-wide folder such as <code>/usr/lib/python3.12/site-packages</code>. <strong>Python has no per-project <code>node_modules</code>:</strong> <code>import requests</code> searches a fixed list of folders (<dfn>sys.path</dfn>) tied to the interpreter, never a folder found by walking up from your project. It is as if npm only had <code>npm install -g</code>.</p>`,
    quiz: {
      q: "Project A needs requests 2.31 and project B needs requests 2.20. With no virtual environment, you run pip install in each project's folder. What happens?",
      options: [
        "Both go to the same site-packages, so the second install replaces the first and one project gets the wrong version",
        { t: "Each project gets its own copy in its own folder", why: "That's how npm works. pip has no per-project folder unless you make one; it installs into the interpreter's site-packages wherever you run it." },
        { t: "Python keeps both and picks the right one per project", why: "One site-packages holds one version of a package; there is no per-project lookup." },
      ],
      answer: 0,
      why: "The folder you run pip from doesn't matter: it installs into the interpreter's one site-packages. That shared folder is the problem virtual environments solve.",
    },
    deeper: `<p><code>sys.path</code> also includes the folder of the script you run, so a <code>.py</code> file next to <code>app.py</code> can be imported. Installed packages, though, only come from site-packages. Many recent systems (macOS Homebrew, Debian, Ubuntu) now refuse a plain <code>pip install</code> into the system Python with an "externally-managed-environment" error, precisely to stop this sharing.</p>`,
  },
  {
    title: "A venv is a folder",
    summary: ".venv = own site-packages + a python link",
    layer: "venv",
    body: `<p>Since Python won't look in a project folder, you make a stand-in. In <code>my-app</code> run <code>python -m venv .venv</code> (<code>-m venv</code> runs the <code>venv</code> tool that ships with Python, a bit like <code>npx</code>). It creates <dfn>.venv</dfn> holding an <strong>empty site-packages of its own</strong>, a <code>bin/</code> folder with <code>python</code> and <code>pip</code>, and a small file, <code>pyvenv.cfg</code>. That <code>bin/python</code> is not a copy of Python: on macOS and Linux it is a <dfn>symlink</dfn> back to the real <dfn>interpreter</dfn>, which is why creating a venv is quick. <code>bin/pip</code> is a small script that runs with that venv <code>python</code>.</p>`,
    code: `my-app/
  app.py
  .venv/
    pyvenv.cfg         ← marks this as a venv
    bin/python  -> /usr/bin/python3.12
    bin/pip
    lib/python3.12/site-packages/  ← empty`,
    analogy: "<code>.venv/lib/…/site-packages</code> plays the role of <code>node_modules</code>. The extra <code>bin/python</code> has no npm counterpart; the next step shows why Python needs it.",
    deeper: `<p>If <code>python</code> isn't found on your machine, use <code>python3</code>; the venv's <code>bin/</code> has both names. On Windows the folder is <code>.venv\\Scripts\\</code> instead of <code>.venv/bin/</code>, and the executables are small copies rather than symlinks. A venv is tied to the Python it was made from: if you delete or upgrade that Python, recreate the venv.</p>`,
  },
  {
    title: "The venv's python looks in .venv",
    summary: "same program, different package folder",
    layer: "prefix",
    body: `<p>So how does a link to the same Python end up using different packages? When you run <code>.venv/bin/python</code>, the system Python starts, but it is told the path it was launched by, <code>.venv/bin/python</code>, not the link's target. It looks for <code>pyvenv.cfg</code> in the parent of that <code>bin/</code> folder, finds it in <code>.venv</code>, and sets <dfn>sys.prefix</dfn> to <code>my-app/.venv</code>. <strong>From that prefix it builds <code>sys.path</code></strong>, so <code>import requests</code> searches <code>.venv</code>'s site-packages instead of the system one. The system site-packages is left out entirely, unless you created the venv with <code>--system-site-packages</code>.</p>`,
    code: `$ .venv/bin/python -c "import sys; print(sys.prefix)"
/home/you/my-app/.venv     ← the venv
$ /usr/bin/python3 -c "import sys; print(sys.prefix)"
/usr                       ← the system`,
    quiz: {
      q: "You installed requests into .venv. Then in a fresh terminal, inside my-app, you run /usr/bin/python3 app.py. What happens at import requests?",
      options: [
        "ModuleNotFoundError: the system python searches the system site-packages, not .venv",
        { t: "It works, because .venv is in the project folder", why: "Python doesn't search the project folder for packages the way Node searches node_modules. Which packages are visible depends on which python you launch." },
        { t: "It works, because the venv python is the same program", why: "It is the same program, but launched from .venv it finds pyvenv.cfg and changes sys.prefix. Launched from /usr/bin it doesn't." },
      ],
      answer: 0,
      why: "Which python you start decides which site-packages it searches. The folder you're standing in doesn't.",
    },
  },
  {
    title: "Activation picks python for you",
    summary: "activate puts .venv/bin first on PATH",
    layer: "activate",
    body: `<p>Typing <code>.venv/bin/python</code> and <code>.venv/bin/pip</code> every time is tedious, and forgetting it silently uses the system copy. So you <dfn>activate</dfn>: <code>source .venv/bin/activate</code>. It <strong>puts <code>.venv/bin</code> at the front of <dfn>PATH</dfn></strong> for this terminal, so plain <code>python</code> and <code>pip</code> find the venv's copies first, and <code>pip install requests</code> lands in <code>.venv</code>. It lasts only for this terminal: a new tab starts with the system python again, so check with the <code>(.venv)</code> prefix on your prompt or <code>which python</code>. Apart from PATH and that prompt prefix, activation changes nothing.</p>`,
    code: `$ source .venv/bin/activate
(.venv) $ which python
/home/you/my-app/.venv/bin/python  ← found first
(.venv) $ pip install requests     # into .venv
(.venv) $ deactivate               # back to normal`,
    analogy: "<code>npm run</code> does this silently: it adds <code>node_modules/.bin</code> to PATH so <code>eslint</code> finds the project's copy. Python makes you do it by hand.",
    deeper: `<p>Your editor (VS Code, PyCharm) has to be pointed at <code>.venv/bin/python</code> too; it doesn't see your terminal's activation, though most detect a <code>.venv</code> folder on their own. Tools like <code>uv run</code> or <code>poetry run</code> skip activation by calling the venv's python directly.</p>`,
  },
  {
    title: "requirements.txt lists the packages",
    summary: "commit the list, not the folder",
    layer: "reqs",
    body: `<p>Now <code>my-app</code> works on your machine, but a teammate needs the same packages. Like <code>node_modules</code>, <strong><code>.venv</code> is never committed</strong>: add it to <code>.gitignore</code>, since it is large and its links point at paths on your machine. Instead you list what to install in <code>requirements.txt</code>, usually with exact versions from <code>pip freeze</code>, which lists every installed package, dependencies of <code>requests</code> included. So it works more like <code>package-lock.json</code> than a hand-written <code>package.json</code>. The teammate creates their own <code>.venv</code>, activates it, and runs <code>pip install -r requirements.txt</code>, their <code>npm install</code>.</p>`,
    code: `# you
(.venv) $ pip freeze > requirements.txt
# teammate, after git clone
$ python -m venv .venv
$ source .venv/bin/activate
(.venv) $ pip install -r requirements.txt`,
    quiz: {
      q: "Your teammate clones my-app and runs pip install -r requirements.txt without creating or activating a venv. Where do the packages go?",
      options: [
        "Into the system site-packages (or pip refuses, on systems that block that)",
        { t: "Into a new .venv that pip creates", why: "npm creates node_modules on its own, but pip never creates a venv; it installs into whichever Python runs it." },
        { t: "Into the .venv from the repo", why: ".venv isn't committed, so the clone has none; and a plain pip is the system one until you activate." },
      ],
      answer: 0,
      why: "requirements.txt only lists packages. The venv has to be created and activated first: npm does that part for you, pip doesn't.",
    },
    deeper: `<p>pip has no field for the Python version itself (npm's <code>engines</code>); teams note it in the README or a <code>.python-version</code> file read by tools such as pyenv and uv. Some keep only direct dependencies in a hand-written <code>requirements.in</code> and generate the pinned file from it. Newer tools bundle these steps the npm way: <code>uv</code> and <code>poetry</code> keep the list in <code>pyproject.toml</code>, write a real lock file (<code>uv.lock</code>, <code>poetry.lock</code>), and create the <code>.venv</code> for you on install.</p>`,
  },
  {
    title: "Recap",
    body: `<p>Python has one shared package folder per install, so a virtual environment gives a project its own: a <code>.venv</code> with its own site-packages and a python that, launched from there, searches only that folder. Activation makes <code>python</code> and <code>pip</code> mean that copy; <code>requirements.txt</code> lets anyone rebuild it.</p>`,
  },
];
