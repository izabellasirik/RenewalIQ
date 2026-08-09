import { Fragment, useState } from 'react';
import { FileText } from 'lucide-react';
import type { MappedTableSection } from '../../types';
import { Card, CardHeader, CardBody } from '../ui';

export function ApplicationTableSection({ table }: { table: MappedTableSection }) {
  const [openSource, setOpenSource] = useState<string | null>(null);

  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader className="pb-3">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">
          {table.title} <span className="font-normal text-[var(--color-ink-400)]">({table.rows.length})</span>
        </h3>
      </CardHeader>
      <CardBody className="pt-2">
        {table.rows.length === 0 ? (
          <p className="text-sm italic text-[var(--color-ink-400)]">No {table.title.toLowerCase()} on file yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-ink-100)] text-left text-xs font-medium text-[var(--color-ink-500)]">
                  {table.columns.map((col) => (
                    <th key={col.key} className="whitespace-nowrap px-2.5 py-2">
                      {col.label}
                    </th>
                  ))}
                  <th className="w-6 print:hidden" />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => {
                  const rowSource = Object.values(row.cells).find((c) => c.source)?.source;
                  return (
                    <Fragment key={row.id}>
                      <tr className="border-b border-[var(--color-ink-50)]">
                        {table.columns.map((col) => {
                          const cell = row.cells[col.key];
                          return (
                            <td key={col.key} className="whitespace-nowrap px-2.5 py-2">
                              {cell?.status === 'missing' ? <span className="italic text-[var(--color-ink-400)]">—</span> : <span className="text-[var(--color-ink-800)]">{cell?.value}</span>}
                            </td>
                          );
                        })}
                        <td className="px-1 print:hidden">
                          {rowSource && (
                            <button
                              onClick={() => setOpenSource((cur) => (cur === row.id ? null : row.id))}
                              className="rounded p-1 text-[var(--color-ink-300)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-500)] cursor-pointer"
                              aria-label="Show source"
                            >
                              <FileText size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {openSource === row.id && rowSource && (
                        <tr className="print:hidden">
                          <td colSpan={table.columns.length + 1} className="bg-[var(--color-ink-50)] px-2.5 py-1.5 text-[11px] text-[var(--color-ink-500)]">
                            Source: {rowSource.documentName}
                            {rowSource.page ? `, page ${rowSource.page}` : ''}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
