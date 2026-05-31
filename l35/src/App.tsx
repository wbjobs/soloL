import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import MonitorPage from "@/pages/MonitorPage";
import SourcesPage from "@/pages/SourcesPage";
import DefensePage from "@/pages/DefensePage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/defense" element={<DefensePage />} />
        </Route>
      </Routes>
    </Router>
  );
}
