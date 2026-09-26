const key = 'RGDIjVTvdFewrhBzjL3rOKNlV9eJ7mg7qTQLjTyu';

async function test(address) {
  const res = await fetch(`https://api.batchdata.com/api/v1/property?address=${encodeURIComponent(address)}`, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

test("19527 E LAKEWAY DR, BATON ROUGE, LA 70810");
