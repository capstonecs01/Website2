import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import SignupCompany from "./pages/SignupCompany";
import SignupStudent from "./pages/SignupStudent";
import VerifyEmail from "./pages/VerifyEmail";
import Login from "./pages/Login";
import DashboardCompany from "./pages/DashboardCompany";
import DashboardStudent from "./pages/DashboardStudent";
import PostProblem from "./pages/PostProblem";
import MyProblemsCompany from "./pages/MyProblemsCompany";
import ProposalsCompany from "./pages/ProposalsCompany";
import ProblemProposals from "./pages/ProblemProposals";
import BrowseProblems from "./pages/BrowseProblems";
import ProblemDetail from "./pages/ProblemDetail";
import StudentWork from "./pages/StudentWork";
import ProjectDetail from "./pages/ProjectDetail";
import Teammates from "./pages/Teammates";
import UserProfile from "./pages/UserProfile";
import Profile from "./pages/Profile";
import Messages from "./pages/Messages";
import Documents from "./pages/Documents";

function App() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signup/company" element={<SignupCompany />} />
        <Route path="/signup/student" element={<SignupStudent />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<Login />} />

        {/* company */}
        <Route path="/dashboard/company" element={<DashboardCompany />} />
        <Route path="/dashboard/company/new" element={<PostProblem />} />
        <Route path="/dashboard/company/problems" element={<MyProblemsCompany />} />
        <Route path="/dashboard/company/proposals" element={<ProposalsCompany />} />
        <Route path="/dashboard/company/problems/:id/proposals" element={<ProblemProposals />} />

        {/* student */}
        <Route path="/dashboard/student" element={<DashboardStudent />} />
        <Route path="/dashboard/student/work" element={<StudentWork />} />
        <Route path="/problems" element={<BrowseProblems />} />
        <Route path="/problems/:id" element={<ProblemDetail />} />
        <Route path="/teammates" element={<Teammates />} />

        {/* shared */}
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/users/:id" element={<UserProfile />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/documents" element={<Documents />} />
      </Routes>
    </div>
  );
}

export default App;
