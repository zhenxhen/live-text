
import React from 'react';

export const MicrophoneIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
  </svg>
);

export const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M6 6h12v12H6z" />
  </svg>
);

export const SpinnerIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg 
        className={className}
        viewBox="0 0 24 24" 
        xmlns="http://www.w3.org/2000/svg" 
        fill="currentColor"
    >
        <path d="M12,23a9.63,9.63,0,0,1-8-4,9.51,9.51,0,0,1-4-8,9.51,9.51,0,0,1,4-8,9.63,9.63,0,0,1,8-4,9.63,9.63,0,0,1,8,4,9.51,9.51,0,0,1,4,8,9.51,9.51,0,0,1-4,8,9.63,9.63,0,0,1-8,4Zm0-17.5A7.5,7.5,0,0,0,4.5,12a7.5,7.5,0,0,0,15,0,7.42,7.42,0,0,0-2.2-5.5,7.5,7.5,0,0,0-5.3-2Z"/>
    </svg>
);
