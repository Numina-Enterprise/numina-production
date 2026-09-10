import {DatabaseSync} from 'node:sqlite';
import {SCHEMA} from '../src/store.js';
export function database(path=':memory:') {
 const sqlite=new DatabaseSync(path);
 for(const statement of SCHEMA)sqlite.exec(statement);
 const prepare=sql=>{let values=[];return {bind(...v){values=v;return this;},async all(){const results=sqlite.prepare(sql).all(...values);return {results,success:true};},async first(){return sqlite.prepare(sql).get(...values)||null;},async run(){return sqlite.prepare(sql).run(...values);}};};
 return {prepare,async batch(stmts){sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of stmts)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();}};
}
