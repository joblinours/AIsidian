type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }) as const;

export const IClose = ({ size = 12 }: P) => <svg {...base(size)} stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IPlus = ({ size = 15 }: P) => <svg {...base(size)} stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>;
export const IEdit = ({ size = 13 }: P) => <svg {...base(size)} stroke-width="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>;
export const IEye = ({ size = 13 }: P) => <svg {...base(size)} stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
export const ISearch = ({ size = 12 }: P) => <svg {...base(size)} stroke-width="2.2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const IGraph = ({ size = 15 }: P) => <svg {...base(size)} stroke="#cba6f7" stroke-width="2"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="10" cy="18" r="2.5" /><path d="M8.2 7.2l7.4.6M7 8.3l2.2 7.4M16.6 10l-5 6" /></svg>;
export const IFolder = ({ size = 14 }: P) => <svg {...base(size)} stroke="#f9e2af" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>;
export const IFile = ({ size = 13 }: P) => <svg {...base(size)} stroke-width="2"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /></svg>;
export const IChevron = ({ size = 11 }: P) => <svg {...base(size)} stroke-width="2.6"><path d="M9 6l6 6-6 6" /></svg>;
export const IUpload = ({ size = 13 }: P) => <svg {...base(size)} stroke-width="2"><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></svg>;
export const IDownload = ({ size = 13 }: P) => <svg {...base(size)} stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></svg>;
export const ISave = ({ size = 13 }: P) => <svg {...base(size)} stroke-width="2"><path d="M5 3h11l3 3v13a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></svg>;
