// Generated local fixtures. These are not mission telemetry or on-orbit observations.
export function packet({apid=42,sequence=0,data=Buffer.from([1,2,3]),type=0,secondary=0,flags=3,version=0}={}){
 const bytes=Buffer.alloc(6+data.length);bytes.writeUInt16BE((version<<13)|(type<<12)|(secondary<<11)|apid,0);bytes.writeUInt16BE((flags<<14)|sequence,2);bytes.writeUInt16BE(data.length-1,4);data.copy(bytes,6);return bytes;
}
export function stacItem(id='generated-point-1'){
 return {type:'Feature',stac_version:'1.1.0',stac_extensions:[],id,geometry:{type:'Point',coordinates:[-94.58,39.1]},bbox:[-94.58,39.1,-94.58,39.1],properties:{datetime:'2026-11-02T00:00:00Z'},links:[],assets:{image:{href:'https://example.invalid/generated-fixture.tif'}}};
}
