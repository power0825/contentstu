import { useEffect, useState } from 'react';
import { t } from './i18n';
import { FileText, Download, LoaderCircle, AlertCircle, FolderDown } from 'lucide-react';

// Files the instructor ships with the studio. They live in public/course/ and are copied into the
// build output, so the list is read from the folder rather than kept in a manifest: dropping a
// file in and redeploying is the whole workflow.
type CourseFile = { name: string; bytes: number; url: string };

function size(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

export default function Course() {
  const [files, setFiles] = useState<CourseFile[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/course').then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Request failed.');
      setFiles(d.files || []);
    }).catch((e) => { setError(e.message); setFiles([]); });
  }, []);

  return <div className="course-page">
    <div className="page-heading"><div><span className="eyebrow">{t('Class materials')}</span><h1>{t('Course files')}</h1><p>{t('Files shared by your instructor.')}</p></div></div>
    {error && <div className="alert error" role="alert"><AlertCircle size={18} /><span>{t(error)}</span></div>}
    {files === null && <div className="course-empty"><LoaderCircle className="spin" size={22} /><p>{t('Loading the library…')}</p></div>}
    {files !== null && files.length === 0 && <section className="panel course-empty"><FolderDown size={38} /><h2>{t('No files yet.')}</h2><p className="helper">{t('Your instructor has not added any files yet. Check back before the next class.')}</p></section>}
    {files !== null && files.length > 0 && <section className="panel"><div className="course-list">{files.map((f) => <div className="course-row" key={f.name}>
      <span className="course-icon"><FileText size={20} /></span>
      <span className="course-meta"><strong>{f.name}</strong><small>{size(f.bytes)}</small></span>
      <a className="button primary small" href={f.url} download><Download size={15} />{t('Download')}</a>
    </div>)}</div></section>}
  </div>;
}
