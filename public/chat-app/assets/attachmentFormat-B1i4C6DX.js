function r(t){return t>=1024*1024?`${(t/(1024*1024)).toFixed(1)} MB`:t>=1024?`${Math.round(t/1024)} KB`:`${t} B`}export{r as f};
