import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';
import { RoomPage } from './pages/RoomPage';
import { ReportPage } from './pages/ReportPage';

const App: React.FC = () => {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:id" element={<EditorPage />} />
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="/project/:id/report" element={<ReportPage />} />
      </Routes>
    </div>
  );
};

export default App;
