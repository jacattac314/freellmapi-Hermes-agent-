import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProvidersPage from './pages/Providers';
import ModelsPage from './pages/Models';
import UsagePage from './pages/Usage';
import PlaygroundPage from './pages/Playground';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/providers" replace />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
