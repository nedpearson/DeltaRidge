const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/features/social/components/CreativeStudioView.tsx';
let content = fs.readFileSync(path, 'utf8');

const regexComingSoon = /<div className="bg-bg-card p-12 text-center rounded-lg border border-border-subtle shadow-sm">[\s\S]*?AI Image Enhancement \(Coming Soon\)[\s\S]*?<\/div>/;
content = content.replace(regexComingSoon, '');

const regexVideoUpload = /const handleVideoUpload = \(e: React\.ChangeEvent<HTMLInputElement>\) => \{[\s\S]*?\}\s*\};/;
const replacementVideoUpload = `const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadState('uploading')
    setUploadProgress(0)
    
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("No supabase");

      // Simple real upload
      const fileExt = file.name.split('.').pop();
      const fileName = \`video_\${crypto.randomUUID()}.\${fileExt}\`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('creative_assets')
        .upload(fileName, file);
        
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('creative_assets').getPublicUrl(fileName);

      setUploadState('processing')
      const { data } = await supabase.functions.invoke('process-video-engine', {
        body: { video_url: publicUrl, organizationId: orgId }
      });

      if (data?.job_id) {
        setVideoJobId(data.job_id);
      }
    } catch (err) {
      console.error(err);
      setUploadState('idle')
    }
  }`;

content = content.replace(regexVideoUpload, replacementVideoUpload);

fs.writeFileSync(path, content);
console.log('Fixed CreativeStudioView');
