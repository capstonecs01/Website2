import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { app } from "./src/server.js";
import { db } from "./src/db/init.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mount the real app in-process on an ephemeral port — no child process,
// nothing left backgrounded across shell calls.
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const PORT = server.address().port;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
async function req(method, pathname, { token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
// Pull the verification token straight from the DB (email delivery not needed for the test).
function tokenFor(email) {
  return db.prepare("SELECT verification_token FROM users WHERE email = ?").get(email)?.verification_token;
}

const stamp = Date.now();
const companyEmail = `hr+${stamp}@acme.test`;
const studentEmail = `pond+${stamp}@kuas.test`;
const PW = "password123";

console.log("\n== 1. Signup ==");
let r = await req("POST", "/auth/signup", {
  body: { email: companyEmail, password: PW, fullName: "Jane Doe", role: "company", companyName: "Acme Co.", jobTitle: "HR Manager" },
});
check("company signup 201", r.status === 201, JSON.stringify(r.data));
r = await req("POST", "/auth/signup", {
  body: { email: studentEmail, password: PW, fullName: "Pond", role: "student", school: "KUAS", major: "CS" },
});
check("student signup 201", r.status === 201, JSON.stringify(r.data));

console.log("\n== 2. Login blocked before verify ==");
r = await req("POST", "/auth/login", { body: { email: companyEmail, password: PW } });
check("login blocked (403) until verified", r.status === 403, JSON.stringify(r.data));

console.log("\n== 2b. Resend verification ==");
const oldToken = tokenFor(companyEmail);
r = await req("POST", "/auth/resend-verification", { body: { email: companyEmail } });
check("resend returns generic 200 (never 500)", r.status === 200, JSON.stringify(r.data));
const newToken = tokenFor(companyEmail);
check("resend issued a NEW token", !!newToken && newToken !== oldToken);
r = await req("POST", "/auth/resend-verification", { body: { email: "nobody@nowhere.test" } });
check("resend for unknown email still 200 (no user enumeration)", r.status === 200);

console.log("\n== 3. Verify emails (using the resent token for company) ==");
r = await req("GET", `/auth/verify?token=${oldToken}`);
check("old token no longer works after resend", r.status === 400, JSON.stringify(r.data));
r = await req("GET", `/auth/verify?token=${newToken}`);
check("company verify ok with resent token", r.status === 200, JSON.stringify(r.data));
r = await req("GET", `/auth/verify?token=${tokenFor(studentEmail)}`);
check("student verify ok", r.status === 200, JSON.stringify(r.data));

console.log("\n== 4. Login ==");
r = await req("POST", "/auth/login", { body: { email: companyEmail, password: PW } });
check("company login 200 + token", r.status === 200 && !!r.data.token);
const companyToken = r.data.token;
r = await req("POST", "/auth/login", { body: { email: studentEmail, password: PW } });
check("student login 200 + token", r.status === 200 && !!r.data.token);
const studentToken = r.data.token;

console.log("\n== 5. Auth guards ==");
r = await req("GET", "/problems");
check("unauth list 401", r.status === 401);
r = await req("POST", "/problems", { token: studentToken, body: { title: "x", description: "y" } });
check("student cannot post problem (403)", r.status === 403, JSON.stringify(r.data));

console.log("\n== 6. Company posts a problem ==");
r = await req("POST", "/problems", {
  token: companyToken,
  body: {
    title: "Build a delivery status tracker",
    description: "We need an internal dashboard to track delivery status across warehouses.",
    tags: "web, dashboard, internal-tools",
    skills: "React, Node.js",
    teamSize: "2-4 people",
    timeline: "6 weeks",
    compensation: "15,000 THB",
  },
});
check("post problem 201", r.status === 201, JSON.stringify(r.data));
check("tags parsed to array", Array.isArray(r.data.problem?.tags) && r.data.problem.tags.length === 3, JSON.stringify(r.data.problem?.tags));
const problemId = r.data.problem.id;

r = await req("POST", "/problems", { token: companyToken, body: { title: "" } });
check("missing fields rejected 400", r.status === 400);

console.log("\n== 7. Company sees own problems ==");
r = await req("GET", "/problems/mine", { token: companyToken });
check("mine lists the problem", r.status === 200 && r.data.problems.some((p) => p.id === problemId));

console.log("\n== 8. Student browses + views detail ==");
r = await req("GET", "/problems", { token: studentToken });
check("browse shows open problem", r.status === 200 && r.data.problems.some((p) => p.id === problemId));
r = await req("GET", "/problems?q=delivery", { token: studentToken });
check("search q=delivery matches", r.status === 200 && r.data.problems.some((p) => p.id === problemId));
r = await req("GET", "/problems?q=zzzznotfound", { token: studentToken });
check("search miss returns none", r.status === 200 && r.data.problems.length === 0);
r = await req("GET", `/problems/${problemId}`, { token: studentToken });
check("detail returns problem, myProposal null", r.status === 200 && r.data.problem.myProposal === null);

console.log("\n== 9. Student submits a proposal ==");
r = await req("POST", `/problems/${problemId}/proposals`, {
  token: studentToken,
  body: { approach: "We'll build it in React + Node with a Postgres backend.", timeline: "5 weeks", teamMembers: "Pond (lead), Mind, Beam" },
});
check("proposal 201", r.status === 201, JSON.stringify(r.data));
const proposalId = r.data.proposal.id;
r = await req("POST", `/problems/${problemId}/proposals`, { token: studentToken, body: { approach: "again" } });
check("duplicate proposal blocked 409", r.status === 409, JSON.stringify(r.data));
r = await req("POST", `/problems/${problemId}/proposals`, { token: companyToken, body: { approach: "x" } });
check("company cannot propose 403", r.status === 403);
r = await req("GET", `/problems/${problemId}`, { token: studentToken });
check("detail now shows myProposal", r.data.problem.myProposal?.id === proposalId);

console.log("\n== 10. Company views + decides ==");
r = await req("GET", `/problems/${problemId}/proposals`, { token: companyToken });
check("company sees 1 proposal w/ student info", r.status === 200 && r.data.proposals.length === 1 && r.data.proposals[0].student.name === "Pond");
r = await req("GET", `/problems/${problemId}/proposals`, { token: studentToken });
check("student cannot view proposals list 403", r.status === 403);
r = await req("PATCH", `/proposals/${proposalId}`, { token: companyToken, body: { status: "accepted" } });
check("company accepts proposal", r.status === 200, JSON.stringify(r.data));

console.log("\n== 11. Student dashboard reflects status ==");
r = await req("GET", "/proposals/mine", { token: studentToken });
check("student sees accepted proposal", r.status === 200 && r.data.proposals[0]?.status === "accepted" && r.data.proposals[0]?.problemTitle?.includes("delivery"));

console.log("\n== 12. Close problem stops new proposals ==");
r = await req("PATCH", `/problems/${problemId}`, { token: companyToken, body: { status: "closed" } });
check("company closes problem", r.status === 200);
// a fresh student to attempt proposing on a closed problem
const s2 = `s2+${stamp}@kuas.test`;
await req("POST", "/auth/signup", { body: { email: s2, password: PW, fullName: "Mint", role: "student", school: "KUAS", major: "IT" } });
await req("GET", `/auth/verify?token=${tokenFor(s2)}`);
const s2t = (await req("POST", "/auth/login", { body: { email: s2, password: PW } })).data.token;
r = await req("POST", `/problems/${problemId}/proposals`, { token: s2t, body: { approach: "late" } });
check("closed problem rejects proposal 409", r.status === 409, JSON.stringify(r.data));
r = await req("GET", "/problems", { token: s2t });
check("closed problem hidden from browse", !r.data.problems.some((p) => p.id === problemId));

// cleanup test rows so the delivered DB stays clean
db.prepare("DELETE FROM proposals WHERE problem_id = ?").run(problemId);
db.prepare("DELETE FROM problems WHERE id = ?").run(problemId);
db.prepare("DELETE FROM users WHERE email IN (?, ?, ?)").run(companyEmail, studentEmail, s2);

console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
server.close();
process.exit(fail === 0 ? 0 : 1);
