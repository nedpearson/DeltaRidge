import { useState, useEffect } from 'react';
import { PenTool, Image as ImageIcon, Video, Sparkles, Wand2, ShieldAlert, CheckCircle } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/features/auth/session';

export default function CreativeStudioView() {
  const session = useSession();
  const orgId = session?.membership?.organizationId || '00000000-0000-0000-0000-000000000000';
  const [activeTab, setActiveTab] = useState<'copy' | 'image' | 'video' | 'competitor'>('copy');
  const [topic, setTopic] = useState('');
  const [pillar, setPillar] = useState('Education');
  const [platform, setPlatform] = useState('Facebook / Meta');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  

  // Image states
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [videoSlices, setVideoSlices] = useState<any[]>([]);

  useEffect(() => {
    if (!videoJobId) return;
    const interval = setInterval(async () => {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data } = await supabase.from('content_engine_jobs').select('*').eq('id', videoJobId).single();
      if (data?.status === 'completed') {
        setVideoSlices(data.results || []);
        clearInterval(interval);
      } else if (data?.status === 'failed') {
        clearInterval(interval);
        alert('Video processing failed: ' + data.error_message);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [videoJobId]);

  
  const [generatedImage, setGeneratedImage] = useState<{ url: string } | null>(null);

  const handleGenerate = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    
    setIsGenerating(true);
    setGeneratedResult(null);
    setCopyError(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-social-copy', {
        body: { topic, pillar, platform, organizationId: orgId }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.copy) setGeneratedResult(data.copy);
    } catch (err: any) {
      console.error(err);
      setCopyError(err.message || "Failed to generate copy");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    
    setIsGeneratingImage(true);
    setGeneratedImage(null);
    setImageError(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-social-image', {
        body: { prompt: imagePrompt, organizationId: orgId }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.asset) setGeneratedImage(data.asset);
    } catch (err: any) {
      console.error(err);
      setImageError(err.message || "Failed to generate image");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-bg-app overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border-subtle bg-bg-card flex flex-col shrink-0">
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Creative Studio</h2>
          <p className="text-xs text-text-secondary mt-1">AI-powered asset generation</p>
        </div>
        <div className="p-2 space-y-1">
          <button 
            onClick={() => setActiveTab('copy')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'copy' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }`}
          >
            <PenTool className="w-4 h-4" /> Copy & Scripts
          </button>
          <button 
            onClick={() => setActiveTab('image')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'image' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }`}
          >
            <ImageIcon className="w-4 h-4" /> Image Generator
          </button>
          <button 
            onClick={() => setActiveTab('video')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'video' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }`}
          >
            <Video className="w-4 h-4" /> Dustin Engine
          </button>
          <button 
            onClick={() => setActiveTab('competitor')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'competitor' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-orange-500" /> Competitor Watch
          </button>
        </div>

        <div className="mt-auto p-4 border-t border-border-subtle bg-brand-primary text-white m-2 rounded-lg relative overflow-hidden">
          <div className="relative z-10">
            <Sparkles className="w-5 h-5 text-brand-primary mb-2" />
            <h3 className="text-sm font-semibold mb-1">Brand Brain Active</h3>
            <p className="text-[10px] text-brand-primary">All generations are automatically aligned to Delta Ridge's tone, policies, and service area.</p>
          </div>
          {/* Decorative background element */}
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-brand-primary rounded-full blur-2xl opacity-50 z-0" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'copy' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-bg-card p-5 rounded-lg border border-border-subtle shadow-sm">
              <h3 className="font-semibold text-text-primary mb-4">Generate Social Post</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Topic / Objective</label>
                  <input 
                    type="text" 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Educational post about spotting hail damage after yesterday's storm in Ascension Parish" 
                    className="w-full px-3 py-2 border border-border-subtle rounded-md text-sm focus:outline-none focus:border-brand-500" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">Content Pillar</label>
                    <select value={pillar} onChange={(e) => setPillar(e.target.value)} className="w-full px-3 py-2 border border-border-subtle rounded-md text-sm bg-bg-card">
                      <option>Education</option>
                      <option>Founder Story</option>
                      <option>Completed Project</option>
                      <option>Storm Preparedness</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">Platform</label>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full px-3 py-2 border border-border-subtle rounded-md text-sm bg-bg-card">
                      <option>Facebook / Meta</option>
                      <option>Instagram</option>
                      <option>Google Business</option>
                      <option>LinkedIn</option>
                    </select>
                  </div>
                </div>
                {copyError && <div className="text-status-critical text-sm mt-2">{copyError}</div>}
                <button 
                  onClick={handleGenerate}
                  disabled={isGenerating || !topic}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded font-medium text-sm hover:bg-brand-primary disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" /> {isGenerating ? 'Generating...' : 'Generate Copy'}
                </button>
              </div>
            </div>

            <div className="border-t border-border-subtle pt-6">
              <h3 className="font-medium text-text-secondary text-sm mb-4">RECENT GENERATIONS</h3>
              <div className="grid gap-4">
                {generatedResult && (
                  <div className="bg-brand-primary/10 p-4 rounded-lg border border-brand-200 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-semibold px-2 py-1 bg-brand-primary rounded text-brand-primary">Just Generated • {platform} • {pillar}</span>
                      <span className="text-xs text-text-secondary">Now</span>
                    </div>
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{generatedResult}</p>
                    <div className="mt-4 flex gap-2">
                      <button 
                        onClick={async () => {
                           const supabase = getSupabase();
                           if (!supabase) return;
                           const { data: assetData, error: assetErr } = await supabase.from('creative_assets').insert({ organization_id: orgId, asset_type: 'copy', provenance: 'ai_generated', content: generatedResult }).select().single();
                             if (!assetErr && assetData) {
                               await supabase.from('content_calendar').insert({
                              organization_id: orgId,
                              creative_asset_id: assetData.id,
                              post_type: 'organic',
                              content_pillar: pillar.toLowerCase(),
                              status: 'draft',
                              scheduled_for: new Date(Date.now() + 86400000).toISOString()
                           });
                             }
                           setGeneratedResult(null); // Clear on schedule
                        }}
                        className="px-3 py-1.5 bg-brand-primary text-white rounded text-xs font-medium hover:bg-brand-primary"
                      >
                        Schedule to Calendar
                      </button>
                      <button className="px-3 py-1.5 border border-brand-200 bg-bg-card rounded text-xs font-medium text-text-primary hover:bg-bg-app">Edit</button>
                    </div>
                  </div>
                )}
                
                <div className="bg-bg-card p-4 rounded-lg border border-border-subtle shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-semibold px-2 py-1 bg-bg-elevated rounded text-text-secondary">Google Business   Education</span>
                    <span className="text-xs text-text-secondary">2 hours ago</span>
                  </div>
                  <p className="text-sm text-text-primary whitespace-pre-wrap">
                    Wondering if that quick burst of hail last night was enough to damage your roof? 
                    {"\n\n"}
                    Most homeowners in Ascension Parish don't realize that even 1-inch hail can compromise asphalt shingles, leading to hidden leaks weeks later. 
                    {"\n\n"}
                    Dustin and the Delta Ridge team are offering free, honest roof assessments all week. We'll show you exactly what we find, no pressure.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'image' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-bg-card p-6 rounded-lg border border-border-subtle shadow-sm">
              <h3 className="font-semibold text-text-primary mb-4">AI Image Generation</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Visual Concept</label>
                  <input 
                    type="text" 
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="e.g. A realistic photo of hail damage on an asphalt shingle roof, extreme close-up" 
                    className="w-full px-3 py-2 border border-border-subtle rounded-md text-sm focus:outline-none focus:border-brand-500" 
                  />
                </div>
                {imageError && <div className="text-status-critical text-sm mt-2">{imageError}</div>}
                <button 
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage || !imagePrompt}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded font-medium text-sm hover:bg-brand-primary disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" /> {isGeneratingImage ? 'Generating...' : 'Generate Image'}
                </button>
              </div>
            </div>
            
            {generatedImage && (
              <div className="bg-bg-card p-6 rounded-lg border border-border-subtle shadow-sm">
                <h3 className="font-semibold text-text-primary mb-4">Generated Asset</h3>
                <div className="relative aspect-square w-full max-w-md mx-auto rounded-lg overflow-hidden border border-border-subtle">
                  <img src={generatedImage.url} alt="Generated asset" className="w-full h-full object-cover" />
                </div>
                <div className="mt-4 flex justify-center gap-4">
                   <button className="px-4 py-2 bg-brand-primary text-white rounded font-medium text-sm hover:bg-brand-primary">Save to Library</button>
                   <button className="px-4 py-2 border border-border-subtle bg-bg-card rounded font-medium text-sm hover:bg-bg-app">Create Post with Image</button>
                </div>
              </div>
            )}
            
            <div className="bg-bg-card p-12 text-center rounded-lg border border-border-subtle shadow-sm">
              <ImageIcon className="w-12 h-12 text-brand-primary mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text-primary">AI Image Enhancement (Coming Soon)</h3>
              <p className="text-sm text-text-secondary max-w-md mx-auto mt-2">
                Upload raw project photos to automatically generate Before/After graphics, branded testimonial cards, or educational storm damage overlays.
              </p>
              <button className="mt-6 px-4 py-2 bg-brand-primary text-white rounded font-medium text-sm hover:bg-brand-primary opacity-50 cursor-not-allowed">
                Upload Project Photos
              </button>
            </div>
          </div>
        )}

        {activeTab === 'video' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-bg-card p-8 rounded-lg border border-border-subtle shadow-sm">
              <div className="flex items-start gap-4">
                <div className="bg-brand-primary p-3 rounded-xl shrink-0">
                  <Video className="w-8 h-8 text-brand-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">The Dustin Content Engine</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    Upload a single long-form video of Dustin answering a homeowner question. The AI will automatically slice it into YouTube Shorts, Reels, generate blog articles, and draft email newsletters.
                  </p>
                </div>
              </div>
                              <div className="mt-8 border-2 border-dashed border-border-subtle rounded-lg p-12 text-center transition-colors">
                  {!videoFile && !videoJobId ? (
                    <>
                      <input type="file" id="video-upload" className="hidden" accept="video/mp4,video/quicktime" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setVideoFile(file);
                        // Simulate upload
                        let prog = 0;
                        const int = setInterval(() => {
                          prog += 10;
                          setUploadProgress(prog);
                          if (prog >= 100) {
                            clearInterval(int);
                            // Invoke engine
                            const supabase = getSupabase();
                            if (supabase) {
                              supabase.functions.invoke('process-video-engine', {
                                body: { video_url: 'https://example.com/mock-video.mp4', organizationId: orgId }
                              }).then(({ data }) => {
                                if (data?.job_id) setVideoJobId(data.job_id);
                              });
                            }
                          }
                        }, 300);
                      }} />
                      <label htmlFor="video-upload" className="cursor-pointer inline-block px-6 py-3 bg-bg-elevated border border-border-subtle rounded-lg font-medium text-text-primary hover:bg-bg-card">
                        Select Video File
                      </label>
                      <p className="text-xs text-text-secondary mt-3">MP4, MOV up to 2GB</p>
                    </>
                  ) : videoJobId && videoSlices.length === 0 ? (
                    <div className="space-y-4">
                      <div className="animate-spin w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full mx-auto"></div>
                      <p className="text-sm font-medium text-text-primary">Dustin Engine is slicing your video...</p>
                      <p className="text-xs text-text-secondary">Generating shorts, reels, and copy. This takes a few minutes.</p>
                    </div>
                  ) : videoJobId && videoSlices.length > 0 ? (
                    <div className="text-left space-y-4">
                      <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-status-success" /> Processing Complete</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {videoSlices.map((slice, i) => (
                          <div key={i} className="p-4 bg-bg-card rounded border border-border-subtle">
                            <span className="text-xs font-semibold px-2 py-1 bg-brand-primary/20 text-brand-primary rounded uppercase">{slice.asset_type}</span>
                            <p className="text-sm text-text-primary mt-2">{slice.content}</p>
                          </div>
                        ))}
                      </div>
                      <button className="w-full mt-2 px-4 py-2 bg-brand-primary text-white rounded font-medium text-sm hover:bg-brand-primary">
                        Review in Content Calendar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-text-primary">Uploading {videoFile?.name}...</p>
                      <div className="w-full bg-bg-app rounded-full h-2.5">
                        <div className="bg-brand-primary h-2.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                    </div>
                  )}
                </div>
            </div>
          </div>
        )}
        
        {activeTab === 'competitor' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-bg-card p-8 rounded-lg border border-border-subtle shadow-sm">
              <div className="flex items-start gap-4 mb-6">
                <div className="bg-warning-surface p-3 rounded-xl shrink-0">
                  <ShieldAlert className="w-8 h-8 text-status-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">Competitor Intelligence Engine</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    The AI autonomously scrapes Meta Ad Library and local social channels to detect aggressive or illegal competitor offers (e.g. "Waiving Deductibles"). When threats are found, counter-messaging is instantly drafted to your Content Calendar.
                  </p>
                </div>
              </div>
              
              <h4 className="font-semibold text-sm mb-4">RECENT INTELLIGENCE LOGS</h4>
              <div className="grid gap-4">
                <div className="p-4 border border-status-critical/30 bg-status-critical/10 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-status-critical text-sm">Big Box Roofing Corp</span>
                    <span className="text-xs text-status-critical font-medium">THREAT DETECTED</span>
                  </div>
                  <p className="text-sm text-text-primary whitespace-pre-wrap italic mb-3">
                    "Get a brand new roof with ZERO down! We waive your deductible! Call today."
                  </p>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 bg-bg-card border border-status-critical/30 rounded text-xs text-status-critical">Violation: Waiving Deductible</span>
                    <span className="px-2 py-1 bg-brand-primary text-brand-primary rounded text-xs">Counter-campaign drafted in Calendar</span>
                  </div>
                </div>
                
                <div className="p-4 border border-border-subtle bg-bg-app rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-text-primary text-sm">Storm Chasers LLC</span>
                    <span className="text-xs text-text-secondary font-medium">Clear</span>
                  </div>
                  <p className="text-sm text-text-primary whitespace-pre-wrap italic mb-3">
                    "We are doing free inspections in Ascension Parish all week."
                  </p>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 bg-bg-card border border-border-subtle rounded text-xs text-text-secondary">Standard Offer</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}












