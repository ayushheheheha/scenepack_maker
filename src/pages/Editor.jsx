export default function Editor({ project, onBack }) {
  // Placeholder — the editing UI is built in a later phase. For now it just
  // confirms the loaded project was handed across from Home.
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg text-white">
      <p className="text-[14px] text-white/70">Editor — coming in a later phase</p>
      {project && (
        <p className="text-[12px] text-[#666]">
          Loaded: {project.drama} · {project.clips.length}{' '}
          {project.clips.length === 1 ? 'clip' : 'clips'}
        </p>
      )}
      <button
        onClick={onBack}
        className="mt-2 inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-[#444] bg-transparent px-4 text-[13px] text-white transition-colors hover:bg-[#1a1a1a]"
      >
        Back to Home
      </button>
    </div>
  )
}
