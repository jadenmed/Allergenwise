import { Route, Routes, useLocation } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import ForRestaurants from "./pages/ForRestaurants";
import ForDiners from "./pages/ForDiners";
import FindRestaurant from "./pages/FindRestaurant";
import Resources from "./pages/Resources";
import Pricing from "./pages/Pricing";
import Course from "./pages/Course";
import CourseLesson from "./pages/CourseLesson";
import ExamPreview from "./pages/ExamPreview";
import ExamSession from "./pages/ExamSession";
import ExamResults from "./pages/ExamResults";
import ExamResultsPending from "./pages/ExamResultsPending";
import ExamResultsFailed from "./pages/ExamResultsFailed";
import Dashboard from "./pages/Dashboard";
import SubmitRestaurant from "./pages/SubmitRestaurant";
import SubmissionStatus from "./pages/SubmissionStatus";
import Staff from "./pages/Staff";
import StaffProfile from "./pages/StaffProfile";
import CertificationRecord from "./pages/CertificationRecord";
import Billing from "./pages/Billing";
import StaffPortal from "./pages/StaffPortal";
import StaffCourse from "./pages/StaffCourse";
import Article from "./pages/Article";
import VerifyCertificate from "./pages/VerifyCertificate";
import ReviewerOverview from "./pages/ReviewerOverview";
import SubmissionQueue from "./pages/SubmissionQueue";
import SubmissionDetail from "./pages/SubmissionDetail";
import CertificationQueue from "./pages/CertificationQueue";

export default function App() {
  const { pathname } = useLocation();
  const isCourseLesson = pathname.startsWith("/course/lesson");
  const isExam = pathname.startsWith("/course/exam");
  const isExamResults = pathname.startsWith("/course/exam/results");
  const isDashboard = pathname.startsWith("/dashboard");
  const isPortal = pathname.startsWith("/portal");
  const isInternal = pathname.startsWith("/internal");
  const hideNavbar = isCourseLesson || isExam || isDashboard || isPortal || isInternal;
  const hideFooter = isCourseLesson || isDashboard || isPortal || isInternal || (isExam && !isExamResults);

  return (
    <div className="flex flex-col items-center w-full">
      <ScrollToTop />
      {!hideNavbar && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/for-restaurants" element={<ForRestaurants />} />
        <Route path="/for-diners" element={<ForDiners />} />
        <Route path="/find-restaurant" element={<FindRestaurant />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/course" element={<Course />} />
        <Route path="/course/lesson/:moduleId/:lessonId" element={<CourseLesson />} />
        <Route path="/course/exam/preview" element={<ExamPreview />} />
        <Route path="/course/exam/results" element={<ExamResults />} />
        <Route
          path="/course/exam/results/pending"
          element={<ExamResultsPending />}
        />
        <Route
          path="/course/exam/results/failed"
          element={<ExamResultsFailed />}
        />
        <Route path="/course/exam" element={<ExamSession />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/submit" element={<SubmitRestaurant />} />
        <Route path="/dashboard/status" element={<SubmissionStatus />} />
        <Route path="/dashboard/staff" element={<Staff />} />
        <Route path="/dashboard/staff/:id" element={<StaffProfile />} />
        <Route path="/dashboard/record" element={<CertificationRecord />} />
        <Route path="/dashboard/billing" element={<Billing />} />
        <Route path="/portal" element={<StaffPortal />} />
        <Route path="/portal/course" element={<StaffCourse />} />
        <Route path="/internal" element={<ReviewerOverview />} />
        <Route path="/internal/submissions" element={<SubmissionQueue />} />
        <Route path="/internal/submissions/:id" element={<SubmissionDetail />} />
        <Route path="/internal/certifications" element={<CertificationQueue />} />
        <Route path="/resources/:slug" element={<Article />} />
        <Route path="/verify/:credentialId" element={<VerifyCertificate />} />
      </Routes>
      {!hideFooter && <Footer />}
    </div>
  );
}
