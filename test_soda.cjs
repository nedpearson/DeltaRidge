const url = "https://data.brla.gov/resource/7ixm-mnvx.json?$where=upper(streetname)%20like%20'%25SANTA%20MARIA%25'&$limit=5";
fetch(url).then(r=>r.json()).then(d=>console.log(d.map(x=>x.typename + ' - ' + x.createdate)));
