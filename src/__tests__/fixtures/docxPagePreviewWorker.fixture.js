import { writeFile } from 'node:fs/promises'
import path from 'node:path'
const directory = process.argv[2]
const { mode } = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(directory, 'fixture.json'), 'utf8'))
await writeFile(path.join(directory, 'fixture-environment.json'), JSON.stringify(Object.keys(process.env)))
if (mode === 'hang') setInterval(() => {}, 1000)
else if (mode === 'crash') process.exit(2)
else if (mode === 'partial') {
  process.send({ contractVersion: 'DOCX_PAGE_RASTER_V1', pages: [{ number: 1 }] }, () => process.disconnect())
} else {
  process.send({ contractVersion: 'INVALID' }, () => process.disconnect())
}
