import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import HowItWorks from "../components/HowItWorks";
import ForCompanies from "../components/ForCompanies";
import ForStudents from "../components/ForStudents";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <HowItWorks />
      <ForCompanies />
      <ForStudents />
      <Footer />
    </>
  );
}
