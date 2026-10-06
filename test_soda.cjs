const url = "https://data.brla.gov/resource/7fq7-8j7r.json?$where=upper(address)%20like%20'%2518931%20SANTA%20MARIA%25'&$limit=10";
fetch(url).then(r=>r.json()).then(d=>console.log(d.map(x=>x.projectdescription + ' - ' + x.permittype + ' - ' + x.issueddate)));
