import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wordlists } from "ethers";
import { ChevronDown } from "lucide-react";

// BIP39 English word list — built once at module load from ethers
const BIP39: string[] = Array.from({ length: 2048 }, (_, i) => wordlists.en.getWord(i));
const BIP39_SET = new Set(BIP39);

// Max autocomplete suggestions shown per input
const MAX_SUGGESTIONS = 6;

type SeedPhraseInputProps = {
  onDerive: (phrase: string) => void;
  message: string | null;
};

export const SeedPhraseInput: React.FC<SeedPhraseInputProps> = ({ onDerive, message }) => {
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(Array(12).fill(""));
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(0); // keyboard nav inside dropdown
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resize words array when word count changes
  useEffect(() => {
    setWords((prev) => {
      const next = Array(wordCount).fill("");
      return next.map((_, i) => prev[i] ?? "");
    });
  }, [wordCount]);

  // Suggestions for the currently focused input
  const suggestions = useMemo<string[]>(() => {
    if (activeIdx === null) return [];
    const val = words[activeIdx]?.toLowerCase().trim();
    if (!val) return [];
    return BIP39.filter((w) => w.startsWith(val)).slice(0, MAX_SUGGESTIONS);
  }, [activeIdx, words]);

  const handleChange = useCallback((idx: number, raw: string) => {
    // Only lowercase letters — strip everything else
    const val = raw.toLowerCase().replace(/[^a-z]/g, "");
    setWords((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
    setHighlightIdx(0);
  }, []);

  const commitWord = useCallback(
    (idx: number, word: string) => {
      setWords((prev) => {
        const next = [...prev];
        next[idx] = word;
        return next;
      });
      setActiveIdx(null);
      setHighlightIdx(0);
      // Advance focus to next empty input (or next input if all filled)
      const nextIdx = idx + 1;
      if (nextIdx < wordCount) {
        setTimeout(() => inputRefs.current[nextIdx]?.focus(), 0);
      }
    },
    [wordCount]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
      if (suggestions.length === 0) {
        // No dropdown — Tab just moves forward naturally
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((h) => Math.min(h + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (suggestions.length > 0) {
          e.preventDefault();
          commitWord(idx, suggestions[highlightIdx] ?? suggestions[0]);
        }
      } else if (e.key === "Escape") {
        setActiveIdx(null);
      }
    },
    [suggestions, highlightIdx, commitWord]
  );

  const handleFocus = useCallback((idx: number) => {
    setActiveIdx(idx);
    setHighlightIdx(0);
  }, []);

  const handleBlur = useCallback((idx: number) => {
    // Only clear activeIdx if it's still this input — avoids a race where the blur
    // timeout from input N fires after input N+1 has already set its own activeIdx.
    setTimeout(() => {
      setActiveIdx((current) => (current === idx ? null : current));
    }, 160);
  }, []);

  const allFilled = words.slice(0, wordCount).every((w) => BIP39_SET.has(w));

  const handleDerive = () => {
    const phrase = words.slice(0, wordCount).join(" ").trim();
    onDerive(phrase);
  };

  const clearAll = () => {
    setWords(Array(wordCount).fill(""));
    setActiveIdx(null);
    setTimeout(() => inputRefs.current[0]?.focus(), 0);
  };

  return (
    <div className="space-y-4">
      {/* ── Word count selector ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400 font-medium">Words:</span>
        {([12, 24] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setWordCount(n)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              wordCount === n
                ? "bg-emerald-600 text-white"
                : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-500"
            }`}
          >
            {n} words
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-600">
          {words.slice(0, wordCount).filter((w) => BIP39_SET.has(w)).length} / {wordCount} valid
        </span>
      </div>

      {/* ── Word input grid ─────────────────────────────────────────── */}
      <div className={`grid gap-2 ${wordCount === 24 ? "grid-cols-4" : "grid-cols-3"}`}>
        {Array.from({ length: wordCount }, (_, i) => {
          const word    = words[i] ?? "";
          const isValid = BIP39_SET.has(word);
          const isTyped = word.length > 0;
          const showDrop = activeIdx === i && suggestions.length > 0;

          return (
            <div key={i} className="relative">
              <div
                className={`flex items-center rounded-lg border text-xs transition-colors ${
                  isTyped && isValid
                    ? "border-emerald-500/60 bg-emerald-500/5"
                    : isTyped && !isValid
                    ? "border-red-500/50 bg-red-500/5"
                    : activeIdx === i
                    ? "border-slate-500 bg-slate-800"
                    : "border-slate-700 bg-slate-900"
                }`}
              >
                {/* Index number */}
                <span className="w-7 flex-shrink-0 text-center text-[10px] text-slate-600 font-mono select-none">
                  {i + 1}
                </span>
                <input
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={word}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onFocus={() => handleFocus(i)}
                  onBlur={() => handleBlur(i)}
                  onKeyDown={(e) => handleKeyDown(e, i)}
                  className="flex-1 min-w-0 bg-transparent py-1.5 pr-2 text-slate-100 font-mono focus:outline-none placeholder:text-slate-700"
                  placeholder={`word ${i + 1}`}
                />
                {isTyped && isValid && (
                  <span className="pr-1.5 text-emerald-500 text-[10px] flex-shrink-0">✓</span>
                )}
              </div>

              {/* Autocomplete dropdown */}
              {showDrop && (
                <ul className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                  {suggestions.map((s, si) => (
                    <li
                      key={s}
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent blur firing before click
                        commitWord(i, s);
                      }}
                      onMouseEnter={() => setHighlightIdx(si)}
                      className={`px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                        si === highlightIdx
                          ? "bg-emerald-600 text-white"
                          : "text-slate-200 hover:bg-slate-700"
                      }`}
                    >
                      <span className="text-slate-500 text-[10px] mr-1.5">{i + 1}.</span>
                      {/* Bold the matching prefix */}
                      <span className="font-semibold">{s.slice(0, word.length)}</span>
                      <span>{s.slice(word.length)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDerive}
            disabled={!allFilled}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronDown size={13} />
            Derive BTC &amp; ETH XPUBs
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Clear
          </button>
        </div>
        {message && (
          <p className="text-[11px] text-slate-400 text-right">{message}</p>
        )}
      </div>
    </div>
  );
};
