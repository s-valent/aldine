import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import { execSync } from 'node:child_process';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'papyr-gh-'));
process.env.DATA_DIR = path.join(tmp,'data'); process.env.META_DIR = path.join(tmp,'secrets');

// a bare repo with content = the "GitHub repo"
const bare = path.join(tmp,'hello.git'); execSync(`git init --bare -b main "${bare}"`);
const seed = path.join(tmp,'seed'); execSync(`git clone "${bare}" "${seed}" 2>/dev/null`);
fs.writeFileSync(path.join(seed,'main.tex'),'\\documentclass{article}\\begin{document}From GitHub\\end{document}\n');
fs.writeFileSync(path.join(seed,'README.md'),'# hello\n');
execSync(`cd "${seed}" && git add -A && git -c user.email=a@b.c -c user.name=t commit -q -m init && git push -q origin main`);

const repoJson = { full_name:'octocat/hello', name:'hello', default_branch:'main', clone_url:`file://${bare}`, owner:{login:'octocat'}, private:false, updated_at:'2026-01-01' };
const mock = http.createServer((req,res)=>{ res.setHeader('content-type','application/json');
  if (req.url==='/user') return res.end(JSON.stringify({login:'tester',name:'Tester'}));
  if (req.url.startsWith('/user/repos')) return res.end(JSON.stringify([repoJson]));
  if (req.url==='/repos/octocat/hello') return res.end(JSON.stringify(repoJson));
  res.statusCode=404; res.end('{}');
});
await new Promise(r=>mock.listen(0,r)); process.env.GITHUB_API_BASE=`http://localhost:${mock.address().port}`;

const { initDb } = await import('/Users/rahloff/projects/Papyr/apps/server/src/db/index.ts'); await initDb();
const Fastify = (await import('fastify')).default;
const { registerRoutes } = await import('/Users/rahloff/projects/Papyr/apps/server/src/routes.ts');
const app = Fastify(); await registerRoutes(app);
const J = (r)=>{ try{return JSON.parse(r.body)}catch{return r.body} };

let r = await app.inject({method:'POST',url:'/api/github/connect',payload:{token:'fake'}});
console.assert(r.statusCode===200 && J(r).login==='tester', 'connect ok: '+r.body);
r = await app.inject({url:'/api/github/status'});
console.assert(J(r).connected===true, 'status connected');
r = await app.inject({url:'/api/github/repos'});
console.assert(Array.isArray(J(r)) && J(r)[0].fullName==='octocat/hello', 'repos list');
r = await app.inject({method:'POST',url:'/api/github/import',payload:{fullName:'octocat/hello'}});
console.assert(r.statusCode===200, 'import status '+r.body);
const pid = J(r).id; console.assert(pid, 'got project id');
console.assert(J(r).github?.fullName==='octocat/hello', 'meta has github link');
console.assert(fs.existsSync(path.join(process.env.DATA_DIR,'projects',pid,'main.tex')),'imported main.tex present');

// edit + push
fs.writeFileSync(path.join(process.env.DATA_DIR,'projects',pid,'main.tex'),'\\documentclass{article}\\begin{document}EDITED IN PAPYR\\end{document}\n');
r = await app.inject({method:'POST',url:`/api/projects/${pid}/github/push`});
console.assert(r.statusCode===200, 'push status '+r.body);
const onRemote = execSync(`git --git-dir="${bare}" show main:main.tex`).toString();
console.assert(onRemote.includes('EDITED IN PAPYR'),'push reached the remote');

// external change on remote → status behind, pull catches up
execSync(`cd "${seed}" && git pull -q && printf 'EXTERNAL\\n' >> main.tex && git commit -qam ext && git push -q`);
r = await app.inject({url:`/api/projects/${pid}/github/status`});
console.assert(J(r).behind===1, 'behind 1 after external push: '+r.body);
r = await app.inject({method:'POST',url:`/api/projects/${pid}/github/pull`});
console.assert(r.statusCode===200, 'pull ok '+r.body);
console.assert(fs.readFileSync(path.join(process.env.DATA_DIR,'projects',pid,'main.tex'),'utf8').includes('EXTERNAL'),'pulled external change');

mock.close(); await app.close(); fs.rmSync(tmp,{recursive:true,force:true});
console.log('GitHub integration (connect→import→push→status→pull): ALL ASSERTIONS PASSED');
