"""Portable snapshots of public asset metadata, without accounts or trading history."""
import json
import sqlite3
from datetime import datetime,timezone
from pathlib import Path

TABLES=('asset_catalog','instruments','asset_summaries','asset_websites','logos','responses','library_prefill','library_failures')
STAMPS={'asset_catalog':'updated_at','instruments':'updated_at','asset_summaries':'updated_at','asset_websites':'updated_at','logos':'saved_at','responses':'fetched_at','library_prefill':'attempted_at','library_failures':'attempted_at'}

def profile_key(key):
    try:
        parts=json.loads(key)
        return isinstance(parts,list) and ((len(parts)==3 and parts[0]=='info' and parts[1] in ('swap','ashare')) or (len(parts)==3 and parts[:2]==['ashare','info-v4']))
    except (ValueError,TypeError):return False

def export_library(source,output):
    source,output=Path(source).resolve(),Path(output).resolve()
    if not source.is_file():raise ValueError('资料数据库不存在')
    if output.exists():raise ValueError('导出文件已存在，请使用新文件名')
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary=output.with_name(output.name+'.preparing')
    if temporary.exists():raise ValueError('存在未完成的导出文件，请先检查')
    counts={}
    try:
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(temporary) as dst:
            src.execute('BEGIN') # One consistent read snapshot even while acquisition is running.
            for table in TABLES:
                schema=src.execute('SELECT sql FROM sqlite_master WHERE type="table" AND name=?',(table,)).fetchone()
                if not schema:continue
                dst.execute(schema[0])
                columns=[row[1] for row in src.execute(f'PRAGMA table_info("{table}")')]
                rows=src.execute(f'SELECT * FROM "{table}"').fetchall()
                if table=='responses':rows=[row for row in rows if profile_key(row[columns.index('key')])]
                dst.executemany(f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in columns)})',rows)
                counts[table]=len(rows)
            dst.execute('CREATE TABLE library_snapshot(format_version INTEGER,created_at TEXT,counts TEXT)')
            dst.execute('INSERT INTO library_snapshot VALUES(1,?,?)',(datetime.now(timezone.utc).isoformat(),json.dumps(counts)))
            dst.commit()
            if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('资料快照完整性检查失败')
        temporary.rename(output)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return counts

def import_library(snapshot,target):
    snapshot,target=Path(snapshot).resolve(),Path(target).resolve()
    if snapshot==target:raise ValueError('源文件和目标文件不能相同')
    target.parent.mkdir(parents=True,exist_ok=True);counts={}
    with sqlite3.connect(snapshot.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(target,timeout=30) as dst:
        if src.execute('SELECT format_version FROM library_snapshot').fetchone()!=(1,):raise ValueError('资料库快照版本不支持')
        if src.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('资料库快照损坏')
        dst.execute('BEGIN IMMEDIATE')
        for table in TABLES:
            schema=src.execute('SELECT sql FROM sqlite_master WHERE type="table" AND name=?',(table,)).fetchone()
            if not schema:continue
            if not dst.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',(table,)).fetchone():dst.execute(schema[0])
            info=src.execute(f'PRAGMA table_info("{table}")').fetchall();columns=[row[1] for row in info]
            if columns!=[row[1] for row in dst.execute(f'PRAGMA table_info("{table}")')]:raise ValueError(f'{table} 表结构不兼容')
            keys=[row[1] for row in sorted(info,key=lambda row:row[5]) if row[5]]
            quoted=lambda name:'"'+name.replace('"','""')+'"'
            update=','.join(f'{quoted(name)}=excluded.{quoted(name)}' for name in columns if name not in keys)
            statement=f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in columns)}) ON CONFLICT({",".join(map(quoted,keys))}) DO UPDATE SET {update} WHERE excluded.{quoted(STAMPS[table])}>"{table}".{quoted(STAMPS[table])}'
            rows=src.execute(f'SELECT * FROM "{table}"').fetchall()
            if table=='responses':rows=[row for row in rows if profile_key(row[columns.index('key')])]
            dst.executemany(statement,rows);counts[table]=len(rows)
        dst.commit()
    return counts
