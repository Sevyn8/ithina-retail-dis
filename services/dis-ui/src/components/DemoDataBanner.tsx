import { Info } from 'lucide-react'

// Demo-data banner (redesign R8). An honest, visible-but-not-alarming notice on the CSV
// journey that the screens run on fixture data: uploaded files are not parsed yet, and the
// mapping shown is sample data. Live parsing and AI-assisted mapping arrive with
// dis-ui-server. Presentation only; new-language styling; light + dark via tokens.
export function DemoDataBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-caption text-muted-foreground"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        Demo data. Uploaded files are not parsed yet, and the mapping shown is sample data. Live
        parsing and AI-assisted mapping arrive with dis-ui-server.
      </span>
    </div>
  )
}
