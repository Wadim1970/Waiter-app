import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomeScreen from './components/WelcomeScreen'
import RegisterScreen from './components/RegisterScreen'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomeScreen />} />
        <Route path="/login" element={<div>Login Screen (скоро)</div>} />
        <Route path="/register" element={<div>Register Screen (скоро)</div>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
