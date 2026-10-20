import bcrypt from "bcrypt";
import { db } from "./init.js";
import { normalizeKeywords } from "../utils/keywords.js";
import { ensureProjectConversations } from "../routes/chat.js";

// Lazily provisioned demo accounts so anyone can inspect BOTH sides of the
// product without signing up / verifying real emails. Created on first
// "Explore as ..." click, already email-verified.
//
// student2 (Kenji) is a teammate so the group chat + student DM are meaningful:
// he never needs to be logged into — he exists to populate the team channels.
const DEMO = {
  company: {
    email: "demo-company@junction.local",
    role: "company",
    fullName: "Ichiro Tanaka",
    companyName: "NexusAI",
    jobTitle: "Company Rep.",
  },
  student: {
    email: "demo-student@junction.local",
    role: "student",
    fullName: "Mina Chen",
    school: "Kyoto University of Advanced Science",
    major: "Computer Science",
  },
  student2: {
    email: "demo-student2@junction.local",
    role: "student",
    fullName: "Kenji Sato",
    school: "Kyoto University of Advanced Science",
    major: "Software Engineering",
  },
};

// Same throwaway password for every demo login — they exist only to look around.
const DEMO_PASSWORD = "demo1234";

// Returns the demo user row for a key, creating it the first time.
export function ensureDemoUser(key) {
  const spec = DEMO[key];
  if (!spec) throw new Error(`no demo user for "${key}"`);

  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(spec.email);
  if (existing) return existing;

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  db.prepare(
    `INSERT INTO users (
       email, password_hash, role, full_name,
       company_name, job_title, school, major,
       email_verified
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    spec.email,
    passwordHash,
    spec.role,
    spec.fullName,
    spec.companyName || null,
    spec.jobTitle || null,
    spec.school || null,
    spec.major || null
  );

  return db.prepare("SELECT * FROM users WHERE email = ?").get(spec.email);
}

// Sample problems (posted by the demo company) + proposals + a couple of chat
// messages so both dashboards and the Messages page have realistic content on
// first visit. Runs at most once — guarded by the demo company having problems.
export function ensureDemoData() {
  const company = ensureDemoUser("company");
  const student = ensureDemoUser("student");
  const student2 = ensureDemoUser("student2");

  const already = db
    .prepare("SELECT COUNT(*) AS n FROM problems WHERE company_id = ?")
    .get(company.id);
  if (already.n > 0) return;

  const problems = [
    {
      title: "Reduce Cart Abandonment Rate on E-commerce Site",
      description:
        "Shoppers add items but drop off before paying. We want a data-informed redesign of the checkout flow to lift completion rate. Bring UX thinking and light front-end prototyping.",
      tags: ["ui-ux", "ecommerce", "web"],
      skills: "React, UX research, analytics",
      teamSize: "2-4 people",
      timeline: "6 weeks",
      compensation: "20,000 THB",
    },
    {
      title: "Internal Knowledge Base Auto-Construction System",
      description:
        "Turn our scattered docs and chat history into a searchable internal knowledge base with automatic summarisation and tagging.",
      tags: ["nlp", "ai", "backend"],
      skills: "Python, LLMs, vector databases",
      teamSize: "3 people",
      timeline: "by 2026-10-01",
      compensation: "Unpaid — portfolio & reference",
    },
    {
      title: "Delivery Status Tracker Dashboard",
      description:
        "A real-time dashboard for our ops team to track delivery status across partners, with alerts on delays.",
      tags: ["data", "web", "automation"],
      skills: "Node.js, React, WebSockets",
      teamSize: "2-3 people",
      timeline: "8 weeks",
      compensation: "15,000 THB",
    },
  ];

  const insertProblem = db.prepare(
    `INSERT INTO problems (company_id, title, description, tags, skills, team_size, timeline, compensation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const ids = [];
  for (const p of problems) {
    const info = insertProblem.run(
      company.id,
      p.title,
      p.description,
      normalizeKeywords(p.tags).join(", "),
      p.skills,
      p.teamSize,
      p.timeline,
      p.compensation,
      "open"
    );
    ids.push(info.lastInsertRowid);
  }

  const insertProposal = db.prepare(
    `INSERT INTO proposals (problem_id, student_id, approach, timeline, team_members, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Project 1 (Cart Abandonment): Mina + Kenji both accepted -> a real team.
  insertProposal.run(
    ids[0],
    student.id,
    "We'll run a quick funnel analysis, then A/B test a streamlined 2-step checkout with autofill and a progress indicator.",
    "5 weeks",
    "Mina (lead), Kenji — CS @ KUAS",
    "accepted"
  );
  insertProposal.run(
    ids[0],
    student2.id,
    "I'll own the front-end prototyping and instrumentation for the A/B test.",
    "5 weeks",
    "Kenji",
    "accepted"
  );
  // Project 2 (Knowledge Base): Mina pending.
  insertProposal.run(
    ids[1],
    student.id,
    "RAG pipeline over your docs with automatic tagging; weekly demo checkpoints.",
    "6 weeks",
    "Mina, Kenji — CS @ KUAS",
    "pending"
  );

  // Spin up the two project channels for the live project and drop in a few
  // starter messages so the chat isn't a blank slate.
  ensureProjectConversations(ids[0]);
  const convAll = db.prepare("SELECT id FROM conversations WHERE type = 'project_all' AND problem_id = ?").get(ids[0]);
  const convStudents = db.prepare("SELECT id FROM conversations WHERE type = 'project_students' AND problem_id = ?").get(ids[0]);

  const insertMsg = db.prepare(
    `INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)`
  );
  if (convAll) {
    insertMsg.run(convAll.id, company.id, "Welcome aboard, team! Great to have you on the checkout project. Let's kick off this week.");
    insertMsg.run(convAll.id, student.id, "Thanks! We'll share a plan by Friday.");
  }
  if (convStudents) {
    insertMsg.run(convStudents.id, student.id, "Hey Kenji — want to split the funnel analysis and the prototype?");
    insertMsg.run(convStudents.id, student2.id, "Sounds good, I'll take the prototype. Sharing a Figma link soon.");
  }
}
