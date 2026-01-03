import React, { useState, useRef, useEffect } from 'react';
import { Upload, Settings, Download, Globe, RefreshCw, Play, Pause, X } from 'lucide-react';

export default function SubtitleExtractor() {
  const [apiKey, setApiKey] = useState('');
  const [showApiInput, setShowApiInput] = useState(true);
  const [video, setVideo] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [subtitles, setSubtitles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [targetLang, setTargetLang] = useState('vi');
  const [showSettings, setShowSettings] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [subtitleRegion, setSubtitleRegion] = useState({ top: 70, height: 25 });
  const [showRegionEditor, setShowRegionEditor] = useState(false);
  const [isDragging, setIsDragging] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedSubIndex, setSelectedSubIndex] = useState(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [threshold, setThreshold] = useState(128);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('gemini_api_key');
    if (saved) {
      setApiKey(saved);
      setShowApiInput(false);
    }
  }, []);

  const saveApiKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    setShowApiInput(false);
  };

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideo(file);
      setVideoUrl(URL.createObjectURL(file));
      setSubtitles([]);
    }
  };

  const extractFrameAtTime = (time) => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      video.currentTime = time;
      video.onseeked = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Apply image enhancements
        ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
        ctx.drawImage(video, 0, 0);
        ctx.filter = 'none';
        
        // Crop to subtitle region only
        const cropY = (canvas.height * subtitleRegion.top) / 100;
        const cropHeight = (canvas.height * subtitleRegion.height) / 100;
        
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = canvas.width;
        croppedCanvas.height = cropHeight;
        const croppedCtx = croppedCanvas.getContext('2d');
        
        croppedCtx.drawImage(
          canvas,
          0, cropY, canvas.width, cropHeight,
          0, 0, canvas.width, cropHeight
        );
        
        // Apply threshold for better OCR
        const imageData = croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const value = avg > threshold ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = value;
        }
        croppedCtx.putImageData(imageData, 0, 0);
        
        croppedCanvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.95);
      };
    });
  };

  const callGeminiVision = async (imageBlob, previousText = '') => {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onloadend = async () => {
        const base64 = reader.result.split(',')[1];
        
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    {
                      text: `Extract ONLY the subtitle text from this image. Rules:
- Return ONLY the subtitle text, nothing else
- If no subtitle visible, return exactly: [NO_SUBTITLE]
- Do not include descriptions, timestamps, or explanations
- Previous subtitle was: "${previousText}"
- If text is same as previous, return [SAME]`
                    },
                    {
                      inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64
                      }
                    }
                  ]
                }],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 100
                }
              })
            }
          );

          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[NO_SUBTITLE]';
          resolve(text);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsDataURL(imageBlob);
    });
  };

  const translateText = async (text, toLang) => {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Translate this subtitle to ${toLang}. Return ONLY the translation, no explanations:\n\n${text}`
              }]
            }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 200
            }
          })
        }
      );

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
    } catch {
      return text;
    }
  };

  const processVideo = async () => {
    if (!apiKey) {
      alert('Please enter your Gemini API key first');
      return;
    }
    
    if (!video) {
      alert('Please upload a video first');
      return;
    }

    setProcessing(true);
    setProgress(0);
    const extractedSubs = [];
    const duration = videoRef.current.duration;
    const interval = 0.5; // Check every 0.5 seconds
    let previousText = '';

    for (let time = 0; time < duration; time += interval) {
      const frame = await extractFrameAtTime(time);
      const text = await callGeminiVision(frame, previousText);
      
      if (text !== '[NO_SUBTITLE]' && text !== '[SAME]' && text !== previousText) {
        extractedSubs.push({
          start: time,
          text: text,
          translated: ''
        });
        previousText = text;
      }
      
      setProgress(Math.round((time / duration) * 100));
    }

    setSubtitles(extractedSubs);
    setProcessing(false);
  };

  const translateSubtitles = async () => {
    setProcessing(true);
    const translated = await Promise.all(
      subtitles.map(async (sub) => ({
        ...sub,
        translated: await translateText(sub.text, targetLang)
      }))
    );
    setSubtitles(translated);
    setProcessing(false);
  };

  const downloadSRT = (useTranslation = false) => {
    let srtContent = '';
    subtitles.forEach((sub, i) => {
      const start = formatSRTTime(sub.start);
      const end = formatSRTTime(subtitles[i + 1]?.start || sub.start + 2);
      const text = useTranslation && sub.translated ? sub.translated : sub.text;
      
      srtContent += `${i + 1}\n${start} --> ${end}\n${text}\n\n`;
    });

    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subtitles_${useTranslation ? 'translated' : 'original'}.srt`;
    a.click();
  };

  const formatSRTTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.ontimeupdate = () => {
        setCurrentTime(videoRef.current.currentTime);
      };
    }
  }, [videoUrl]);

  const handleRegionMouseDown = (e, type) => {
    if (!showRegionEditor) return;
    setIsDragging(type);
    e.preventDefault();
  };

  const handleRegionMouseMove = (e) => {
    if (!isDragging || !overlayRef.current) return;
    
    const rect = overlayRef.current.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    if (isDragging === 'top') {
      const newTop = Math.max(0, Math.min(y, subtitleRegion.top + subtitleRegion.height - 5));
      setSubtitleRegion({
        ...subtitleRegion,
        top: newTop,
        height: subtitleRegion.height + (subtitleRegion.top - newTop)
      });
    } else if (isDragging === 'bottom') {
      const newHeight = Math.max(5, Math.min(y - subtitleRegion.top, 100 - subtitleRegion.top));
      setSubtitleRegion({...subtitleRegion, height: newHeight});
    } else if (isDragging === 'move') {
      const newTop = Math.max(0, Math.min(y - subtitleRegion.height / 2, 100 - subtitleRegion.height));
      setSubtitleRegion({...subtitleRegion, top: newTop});
    }
  };

  const handleRegionMouseUp = () => {
    setIsDragging(null);
  };

  const updateSubtitle = (index, field, value) => {
    const updated = [...subtitles];
    updated[index][field] = value;
    setSubtitles(updated);
  };

  const deleteSubtitle = (index) => {
    setSubtitles(subtitles.filter((_, i) => i !== index));
  };

  const splitSubtitle = (index) => {
    const sub = subtitles[index];
    const nextSub = subtitles[index + 1];
    const midTime = nextSub ? (sub.start + nextSub.start) / 2 : sub.start + 2;
    
    const newSub = {
      start: midTime,
      text: '',
      translated: ''
    };
    
    const updated = [...subtitles];
    updated.splice(index + 1, 0, newSub);
    setSubtitles(updated);
  };

  const mergeSubtitles = (index) => {
    if (index >= subtitles.length - 1) return;
    
    const updated = [...subtitles];
    updated[index].text += ' ' + updated[index + 1].text;
    if (updated[index].translated) {
      updated[index].translated += ' ' + updated[index + 1].translated;
    }
    updated.splice(index + 1, 1);
    setSubtitles(updated);
  };

  const currentSubtitle = subtitles.find(
    (sub, i) => currentTime >= sub.start && currentTime < (subtitles[i + 1]?.start || Infinity)
  );

  if (showApiInput) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Settings className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Video Subtitle OCR</h1>
            <p className="text-gray-600">Enter your Gemini API key to get started</p>
          </div>
          
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter Gemini API Key"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg mb-4 focus:outline-none focus:border-indigo-500"
          />
          
          <button
            onClick={saveApiKey}
            disabled={!apiKey}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-6 text-white">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold">Video Subtitle OCR Extractor</h1>
              <button
                onClick={() => setShowApiInput(true)}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition"
              >
                <Settings className="w-4 h-4" />
                Change API Key
              </button>
            </div>
          </div>

          <div className="p-6 grid md:grid-cols-2 gap-6">
            {/* Left Panel */}
            <div className="space-y-4">
              {/* Upload */}
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-indigo-500 transition">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  className="hidden"
                  id="video-upload"
                />
                <label htmlFor="video-upload" className="cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-gray-600 font-medium">Click to upload video</p>
                  <p className="text-sm text-gray-400 mt-1">MP4, WebM, AVI supported</p>
                </label>
              </div>

              {/* Video Player */}
              {videoUrl && (
                <div className="relative rounded-xl overflow-hidden bg-black">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full"
                    controls
                  />
                  
                  {/* Region Overlay */}
                  {showRegionEditor && (
                    <div 
                      ref={overlayRef}
                      className="absolute inset-0 cursor-move"
                      onMouseMove={handleRegionMouseMove}
                      onMouseUp={handleRegionMouseUp}
                      onMouseLeave={handleRegionMouseUp}
                    >
                      {/* Dark overlay outside region */}
                      <div 
                        className="absolute inset-x-0 bg-black/60"
                        style={{ top: 0, height: `${subtitleRegion.top}%` }}
                      />
                      <div 
                        className="absolute inset-x-0 bg-black/60"
                        style={{ top: `${subtitleRegion.top + subtitleRegion.height}%`, bottom: 0 }}
                      />
                      
                      {/* Active region */}
                      <div 
                        className="absolute inset-x-0 border-2 border-green-400 bg-green-400/10"
                        style={{ 
                          top: `${subtitleRegion.top}%`, 
                          height: `${subtitleRegion.height}%` 
                        }}
                        onMouseDown={(e) => handleRegionMouseDown(e, 'move')}
                      >
                        {/* Top handle */}
                        <div 
                          className="absolute inset-x-0 top-0 h-1 bg-green-400 cursor-ns-resize hover:h-2 transition-all"
                          onMouseDown={(e) => handleRegionMouseDown(e, 'top')}
                        />
                        
                        {/* Bottom handle */}
                        <div 
                          className="absolute inset-x-0 bottom-0 h-1 bg-green-400 cursor-ns-resize hover:h-2 transition-all"
                          onMouseDown={(e) => handleRegionMouseDown(e, 'bottom')}
                        />
                        
                        {/* Label */}
                        <div className="absolute top-2 left-2 bg-green-400 text-black px-2 py-1 rounded text-xs font-bold">
                          OCR Region
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Current subtitle display */}
                  {currentSubtitle && !showRegionEditor && (
                    <div className="absolute bottom-16 left-0 right-0 text-center">
                      <div className="inline-block bg-black/80 text-white px-4 py-2 rounded-lg text-lg">
                        {currentSubtitle.translated || currentSubtitle.text}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Region Settings */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-gray-800">OCR Settings</h3>
                  <button
                    onClick={() => setShowRegionEditor(!showRegionEditor)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                      showRegionEditor 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {showRegionEditor ? '✓ Done' : 'Adjust Region'}
                  </button>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-600 flex justify-between">
                      <span>Region Top: {subtitleRegion.top.toFixed(0)}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={subtitleRegion.top}
                      onChange={(e) => setSubtitleRegion({...subtitleRegion, top: +e.target.value})}
                      className="w-full"
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-600 flex justify-between">
                      <span>Region Height: {subtitleRegion.height.toFixed(0)}%</span>
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      value={subtitleRegion.height}
                      onChange={(e) => setSubtitleRegion({...subtitleRegion, height: +e.target.value})}
                      className="w-full"
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-600 flex justify-between">
                      <span>Brightness: {brightness}%</span>
                    </label>
                    <input
                      type="range"
                      min="50"
                      max="200"
                      value={brightness}
                      onChange={(e) => setBrightness(+e.target.value)}
                      className="w-full"
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-600 flex justify-between">
                      <span>Contrast: {contrast}%</span>
                    </label>
                    <input
                      type="range"
                      min="50"
                      max="200"
                      value={contrast}
                      onChange={(e) => setContrast(+e.target.value)}
                      className="w-full"
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-600 flex justify-between">
                      <span>Threshold: {threshold}</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="255"
                      value={threshold}
                      onChange={(e) => setThreshold(+e.target.value)}
                      className="w-full"
                    />
                  </div>
                  
                  <button
                    onClick={() => {
                      setBrightness(100);
                      setContrast(100);
                      setThreshold(128);
                    }}
                    className="w-full text-sm text-gray-600 hover:text-gray-800 py-1"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <button
                  onClick={processVideo}
                  disabled={!video || processing}
                  className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-5 h-5 ${processing ? 'animate-spin' : ''}`} />
                  {processing ? `Processing... ${progress}%` : 'Extract Subtitles'}
                </button>
                
                {subtitles.length > 0 && (
                  <>
                    <button
                      onClick={() => setEditMode(!editMode)}
                      className={`w-full py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 ${
                        editMode 
                          ? 'bg-green-600 text-white hover:bg-green-700' 
                          : 'bg-gray-600 text-white hover:bg-gray-700'
                      }`}
                    >
                      {editMode ? '✓ Done Editing' : '✏️ Edit Subtitles'}
                    </button>

                    <div className="flex gap-2">
                      <select
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500"
                      >
                        <option value="vi">Vietnamese</option>
                        <option value="en">English</option>
                        <option value="zh">Chinese</option>
                        <option value="ja">Japanese</option>
                        <option value="ko">Korean</option>
                      </select>
                      <button
                        onClick={translateSubtitles}
                        disabled={processing}
                        className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 transition flex items-center gap-2"
                      >
                        <Globe className="w-5 h-5" />
                        Translate
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => downloadSRT(false)}
                        className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2"
                      >
                        <Download className="w-5 h-5" />
                        Download Original
                      </button>
                      <button
                        onClick={() => downloadSRT(true)}
                        className="flex-1 bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition flex items-center justify-center gap-2"
                      >
                        <Download className="w-5 h-5" />
                        Download Translated
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right Panel - Subtitles */}
            <div className="bg-gray-50 rounded-xl p-4">
              <h3 className="font-semibold mb-4 text-gray-800 text-lg">
                Extracted Subtitles ({subtitles.length})
              </h3>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {subtitles.map((sub, i) => (
                  <div 
                    key={i} 
                    className={`bg-white p-4 rounded-lg shadow-sm transition ${
                      selectedSubIndex === i ? 'ring-2 ring-indigo-500' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-xs text-gray-500">
                        {formatSRTTime(sub.start)}
                      </div>
                      {editMode && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.currentTime = sub.start;
                              }
                            }}
                            className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200"
                            title="Jump to time"
                          >
                            ▶
                          </button>
                          <button
                            onClick={() => splitSubtitle(i)}
                            className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded hover:bg-green-200"
                            title="Split"
                          >
                            ✂
                          </button>
                          {i < subtitles.length - 1 && (
                            <button
                              onClick={() => mergeSubtitles(i)}
                              className="text-xs bg-yellow-100 text-yellow-600 px-2 py-1 rounded hover:bg-yellow-200"
                              title="Merge with next"
                            >
                              ⇄
                            </button>
                          )}
                          <button
                            onClick={() => deleteSubtitle(i)}
                            className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200"
                            title="Delete"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {editMode ? (
                      <>
                        <input
                          type="number"
                          step="0.1"
                          value={sub.start}
                          onChange={(e) => updateSubtitle(i, 'start', +e.target.value)}
                          className="w-full text-xs mb-2 px-2 py-1 border border-gray-300 rounded"
                          placeholder="Start time"
                        />
                        <textarea
                          value={sub.text}
                          onChange={(e) => updateSubtitle(i, 'text', e.target.value)}
                          className="w-full text-gray-800 font-medium mb-2 px-2 py-1 border border-gray-300 rounded resize-none"
                          rows="2"
                        />
                        {sub.translated && (
                          <textarea
                            value={sub.translated}
                            onChange={(e) => updateSubtitle(i, 'translated', e.target.value)}
                            className="w-full text-indigo-600 px-2 py-1 border border-indigo-300 rounded resize-none"
                            rows="2"
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-gray-800 font-medium">{sub.text}</div>
                        {sub.translated && (
                          <div className="text-indigo-600 mt-2">{sub.translated}</div>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {subtitles.length === 0 && (
                  <div className="text-center text-gray-400 py-12">
                    No subtitles extracted yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
