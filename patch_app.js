const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add Icons
code = code.replace(
  /import \{ LogIn, LogOut, (.*?) \} from "lucide-react";/,
  'import { LogIn, LogOut, $1, Sun, Moon, Eye } from "lucide-react";'
);

// 2. Add State
code = code.replace(
  /const \[isListening, setIsListening\] = useState\(false\);/,
  `const [isListening, setIsListening] = useState(false);\n  const [theme, setTheme] = useState<"dark" | "light" | "hc">("dark");`
);

// 3. Add root class
code = code.replace(
  /<div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans relative overflow-hidden">/,
  `<div className={\`flex flex-col h-screen bg-slate-950 text-slate-100 font-sans relative overflow-hidden theme-\${theme}\`}>`
);

// 4. Add Button in Header (before model select)
const buttonHtml = `
          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(prev => prev === "dark" ? "light" : prev === "light" ? "hc" : "dark")}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/50 border border-slate-700/50 rounded-lg transition-colors flex items-center justify-center mr-2"
            title="Toggle Theme"
          >
            {theme === "dark" && <Moon className="w-5 h-5" />}
            {theme === "light" && <Sun className="w-5 h-5" />}
            {theme === "hc" && <Eye className="w-5 h-5" />}
          </button>
`;

code = code.replace(
  /<div className="relative">\s*<select\s*value=\{modelSelection\}/,
  buttonHtml + '\n          <div className="relative">\n            <select\n              value={modelSelection}'
);

fs.writeFileSync('src/App.tsx', code);
console.log('patched');
