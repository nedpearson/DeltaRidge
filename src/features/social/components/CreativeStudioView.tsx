import { useState } from 'react';
import { PenTool, Image as ImageIcon, Video, Sparkles, Wand2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';

export default function CreativeStudioView() {
  const [activeTab, setActiveTab] = useState<'copy' | 'image' | 'video'>('copy');
  const [topic, setTopic] = useState('');
  const [pillar, setPillar] = useState('Education');
  const [platform, setPlatform] = useState('Facebook / Meta');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<string | null>(null);

  // Image states
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<any | null>(null);

  const handleGenerate = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    
    setIsGenerating(true);
    setGeneratedResult(null);
    try {
      const orgId = "00000000-0000-0000-0000-000000000000"; 
      const { data, error } = await supabase.functions.invoke('generate-social-copy', {
        body: { topic, pillar, platform, organizationId: orgId }
      });
      if (error) throw error;
      if (data?.copy) setGeneratedResult(data.copy);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    
    setIsGeneratingImage(true);
    setGeneratedImage(null);
    try {
      const orgId = "00000000-0000-0000-0000-000000000000"; 
      const { data, error } = await supabase.functions.invoke('generate-social-image', {
        body: { prompt: imagePrompt, organizationId: orgId }
      });
      if (error) throw error;
      if (data?.asset) setGeneratedImage(data.asset);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-surface-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-white flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Creative Studio</h2>
          <p className="text-xs text-text-secondary mt-1">AI-powered asset generation</p>
        </div>
        <div className="p-2 space-y-1">
          <button 
            onClick={() => setActiveTab('copy')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'copy' ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-100 hover:text-text'
            }`}
          >
            <PenTool className="w-4 h-4" /> Copy & Scripts
          </button>
          <button 
            onClick={() => setActiveTab('image')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'image' ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-100 hover:text-text'
            }`}
          >
            <ImageIcon className="w-4 h-4" /> Image Generator
          </button>
          <button 
            onClick={() => setActiveTab('video')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'video' ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-100 hover:text-text'
            }`}
          >
            <Video className="w-4 h-4" /> Dustin Engine
          </button>
        </div>

        <div className="mt-auto p-4 border-t border-border bg-brand-900 text-white m-2 rounded-lg relative overflow-hidden">
          <div className="relative z-10">
            <Sparkles className="w-5 h-5 text-brand-300 mb-2" />
            <h3 className="text-sm font-semibold mb-1">Brand Brain Active</h3>
            <p className="text-[10px] text-brand-200">All generations are automatically aligned to Delta Ridge's tone, policies, and service area.</p>
          </div>
          {/* Decorative background element */}
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-brand-800 rounded-full blur-2xl opacity-50 z-0" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'copy' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white p-5 rounded-lg border border-border shadow-sm">
              <h3 className="font-semibold text-text mb-4">Generate Social Post</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-1">Topic / Objective</label>
                  <input 
                    type="text" 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Educational post about spotting hail damage after yesterday's storm in Ascension Parish" 
                    className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:border-brand-500" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text mb-1">Content Pillar</label>
                    <select value={pillar} onChange={(e) => setPillar(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-white">
                      <option>Education</option>
                      <option>Founder Story</option>
                      <option>Completed Project</option>
                      <option>Storm Preparedness</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text mb-1">Platform</label>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-white">
                      <option>Facebook / Meta</option>
                      <option>Instagram</option>
                      <option>Google Business</option>
                      <option>LinkedIn</option>
                    </select>
                  </div>
                </div>
                <button 
                  onClick={handleGenerate}
                  disabled={isGenerating || !topic}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700 disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" /> {isGenerating ? 'Generating...' : 'Generate Copy'}
                </button>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="font-medium text-text-secondary text-sm mb-4">RECENT GENERATIONS</h3>
              <div className="grid gap-4">
                {generatedResult && (
                  <div className="bg-brand-50 p-4 rounded-lg border border-brand-200 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-semibold px-2 py-1 bg-brand-100 rounded text-brand-700">Just Generated • {platform} • {pillar}</span>
                      <span className="text-xs text-text-secondary">Now</span>
                    </div>
                    <p className="text-sm text-text whitespace-pre-wrap">{generatedResult}</p>
                    <div className="mt-4 flex gap-2">
                      <button 
                        onClick={async () => {
                           const supabase = getSupabase();
                           if (!supabase) return;
                           const orgId = "00000000-0000-0000-0000-000000000000"; 
                           await supabase.from('content_calendar').insert({
                              organization_id: orgId,
                              content: generatedResult,
                              post_type: 'organic',
                              content_pillar: pillar.toLowerCase(),
                              status: 'draft',
                              scheduled_for: new Date(Date.now() + 86400000).toISOString()
                           });
                           alert('Scheduled to Content Calendar as Draft!');
                        }}
                        className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs font-medium hover:bg-brand-700"
                      >
                        Schedule to Calendar
                      </button>
                      <button className="px-3 py-1.5 border border-brand-200 bg-white rounded text-xs font-medium text-text hover:bg-surface-50">Edit</button>
                    </div>
                  </div>
                )}
                
                <div className="bg-white p-4 rounded-lg border border-border shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-semibold px-2 py-1 bg-surface-100 rounded text-text-secondary">Google Business   Education</span>
                    <span className="text-xs text-text-secondary">2 hours ago</span>
                  </div>
                  <p className="text-sm text-text whitespace-pre-wrap">
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
            <div className="bg-white p-6 rounded-lg border border-border shadow-sm">
              <h3 className="font-semibold text-text mb-4">AI Image Generation</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-1">Visual Concept</label>
                  <input 
                    type="text" 
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="e.g. A realistic photo of hail damage on an asphalt shingle roof, extreme close-up" 
                    className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:border-brand-500" 
                  />
                </div>
                <button 
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage || !imagePrompt}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700 disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" /> {isGeneratingImage ? 'Generating...' : 'Generate Image'}
                </button>
              </div>
            </div>
            
            {generatedImage && (
              <div className="bg-white p-6 rounded-lg border border-border shadow-sm">
                <h3 className="font-semibold text-text mb-4">Generated Asset</h3>
                <div className="relative aspect-square w-full max-w-md mx-auto rounded-lg overflow-hidden border border-border">
                  <img src={generatedImage.url} alt="Generated asset" className="w-full h-full object-cover" />
                </div>
                <div className="mt-4 flex justify-center gap-4">
                   <button className="px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700">Save to Library</button>
                   <button className="px-4 py-2 border border-border bg-white rounded font-medium text-sm hover:bg-surface-50">Create Post with Image</button>
                </div>
              </div>
            )}
            
            <div className="bg-white p-12 text-center rounded-lg border border-border shadow-sm">
              <ImageIcon className="w-12 h-12 text-brand-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text">AI Image Enhancement (Coming Soon)</h3>
              <p className="text-sm text-text-secondary max-w-md mx-auto mt-2">
                Upload raw project photos to automatically generate Before/After graphics, branded testimonial cards, or educational storm damage overlays.
              </p>
              <button className="mt-6 px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700 opacity-50 cursor-not-allowed">
                Upload Project Photos
              </button>
            </div>
          </div>
        )}

        {activeTab === 'video' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white p-8 rounded-lg border border-border shadow-sm">
              <div className="flex items-start gap-4">
                <div className="bg-brand-100 p-3 rounded-xl shrink-0">
                  <Video className="w-8 h-8 text-brand-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text">The Dustin Content Engine</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    Upload a single long-form video of Dustin answering a homeowner question. The AI will automatically slice it into YouTube Shorts, Reels, generate blog articles, and draft email newsletters.
                  </p>
                </div>
              </div>
              <div className="mt-8 border-2 border-dashed border-border rounded-lg p-12 text-center hover:bg-surface-50 transition-colors cursor-pointer">
                <p className="text-sm font-medium text-text">Drag & drop raw video file here</p>
                <p className="text-xs text-text-secondary mt-1">MP4, MOV up to 2GB</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
