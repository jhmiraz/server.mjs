import React, { useEffect, useState } from "react";

import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./components/firebase-config";
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import SearchBar from './components/SearchBar';
import CreationPage from './components/CreationPage';
import ScriptGenerator from './components/ScriptGenerator';
import GeneratedVideo from './components/GeneratedVideo';
import PricingPage from './components/PricingPage';
import SEOKeywordGenerator from './components/SEOKeywordGenerator';
import GhostAssistant from './components/GhostAssistant'; 
import TextToSpeechPage from './components/TextToSpeechPage';
import VideoToClips from './components/VideoToClips';
import Profile from './components/Profile';
import GenerateVideo from './components/GenerateVideo';

import Benefits from './components/Benefits'; 
import Footer from './components/Footer';

import AboutUs from './components/pages/AboutUs';
import ContactUs from './components/pages/ContactUs';
import Help from './components/pages/Help';
import PrivacyPolicy from './components/pages/PrivacyPolicy';
import Disclaimer from './components/pages/Disclaimer';
import AuthComponent from './components/AuthComponent'; 
import ComponentTest from "./components/pages/testComponents";

import './App.css';

function App() {
  const [videoUrl, setVideoUrl] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);  // Update user state on login
        localStorage.setItem("user", JSON.stringify(currentUser));
      } else {
        setUser(null);
        localStorage.removeItem("user");
      }
    });
    return () => unsubscribe();  // Cleanup listener
  }, []);
  
  

  const generateVideo = async (script) => {
    try {
      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ script }), // Sending the script to the server
      });

      if (response.ok) {
        const data = await response.json();
        setVideoUrl(data.videoUrl); // Update the state with the video URL
      } else {
        console.error('Failed to generate video');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <Router>
      <div className="App">
        <Navbar />
        
        {/* Main content home page routes */}
        <Routes>
          <Route path="/" element={
            <>
              <Hero />
              <SearchBar />
              <Benefits /> 
              <Footer />
              
              
            </>
          } />
          <Route path="/create-content" element={
            <CreationPage onGenerateVideo={generateVideo} />
          } />
          <Route path="/generate-script" element={<ScriptGenerator />} />
          <Route path="/generated-video" element={<GeneratedVideo videoUrl={videoUrl} />} />

          <Route path="/generate-seo" element={<SEOKeywordGenerator />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/text-to-speech" element={<TextToSpeechPage />} />
          <Route path="/video-to-clips" element={<VideoToClips />} />
          <Route path="/profile" element={<Profile user={user} />} />
          <Route path="/generate-video" element={<GenerateVideo videoUrl={videoUrl}/>} />
          <Route path="/auth" element={<AuthComponent />} />

          <Route path="/about-us" element={<AboutUs />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/help" element={<Help />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/disclaimer" element={<Disclaimer />} />

        </Routes>

        {/* Floating Ghost Assistant, appears at bottom-left corner across all pages */}
        <GhostAssistant />
        
      </div>
    </Router>
  );
}

export default App;
