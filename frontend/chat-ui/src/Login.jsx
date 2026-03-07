import { useState } from "react";
import { auth } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import NeuralBackground from "./NeuralBackground";
import "./login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    setError("");
    setLoading(true);
    try {
      if (isSignup) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/ \(auth\/.*\)\.?/, ""));
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="login-wrapper">
      <NeuralBackground />
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>

          <h2 className="login-title">Ehan AI</h2>
          <p className="login-subtitle">
            {isSignup ? "Create your account" : "Welcome back"}
          </p>

          <div className="login-field">
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button
            className="login-btn"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Please wait…" : isSignup ? "Create Account" : "Sign In"}
          </button>

          <p className="login-switch">
            {isSignup ? "Already have an account? " : "New to Ehan AI? "}
            <span onClick={() => { setIsSignup(!isSignup); setError(""); }}>
              {isSignup ? "Sign in" : "Create account"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
