import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomeScreen from './components/WelcomeScreen'
import RegisterScreen from './components/RegisterScreen'
import VerificationScreen from './components/VerificationScreen'
import AuthCheck from './components/AuthCheck'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthCheck />
      <Routes>
        <Route path="/" element={<WelcomeScreen />} />
        <Route path="/login" element={<div>Login Screen (скоро)</div>} />
        <Route path="/register" element={<RegisterScreen />} />
        <Route path="/verification" element={<VerificationScreen />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
