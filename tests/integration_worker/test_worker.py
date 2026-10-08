import gzip
import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('worker',Path(__file__).resolve().parents[2]/'scripts/integration_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkerTests(unittest.TestCase):
 def test_latest_file_uses_timestamp_not_directory_order(self):
  stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
  name=f'MRMS_MESH_Max_1440min_00.50_{stamp}.grib2.gz'
  found,_=worker.latest_file(f'<a href="{name}">latest</a><a href="MRMS_MESH_Max_1440min_00.50_20200101-000000.grib2.gz">old</a>')
  self.assertEqual(found,name)
 def test_stale_grid_is_rejected(self):
  with self.assertRaises(ValueError):worker.latest_file('<a href="MRMS_MESH_Max_1440min_00.50_20200101-000000.grib2.gz">old</a>')
 def test_units_missing_cells_and_territory(self):
  cells,count,missing=worker.crop_grid([30.4,30.4,30.4,30.4,32],[268.9,268.9,268.9,268.9,268.9],[25.4,0,-3,9999,50.8],[-91.5,30,-90.5,31])
  self.assertEqual(count,2);self.assertEqual(cells,[[-91.1,30.4,1.0]])
 def test_missing_data_is_not_converted_to_zero_hail(self):
  cells,count,missing=worker.crop_grid([30],[269],[-3],[-92,29,-90,31])
  self.assertEqual((cells,count,missing),([],0,1))
 def test_push_destination_restrictions(self):
  self.assertTrue(worker.safe_push_endpoint('https://fcm.googleapis.com/fcm/send/device'))
  self.assertFalse(worker.safe_push_endpoint('https://127.0.0.1/private'))
  self.assertFalse(worker.safe_push_endpoint('https://fcm.googleapis.com.evil.test/push'))
 def test_real_grib_decode(self):
  try:
   from eccodes import codes_grib_new_from_samples,codes_set,codes_set_values,codes_get_message,codes_release
  except ImportError:self.skipTest('ecCodes is not installed locally; required in integration CI')
  handle=codes_grib_new_from_samples('regular_ll_sfc_grib2')
  try:
   for key,value in {'Ni':2,'Nj':2,'latitudeOfFirstGridPointInDegrees':31,'longitudeOfFirstGridPointInDegrees':268,'latitudeOfLastGridPointInDegrees':30,'longitudeOfLastGridPointInDegrees':269,'iDirectionIncrementInDegrees':1,'jDirectionIncrementInDegrees':1}.items():codes_set(handle,key,value)
   codes_set_values(handle,[25.4,0,50.8,0])
   cells,count,missing=worker.decode_grid(gzip.compress(codes_get_message(handle)),[-92,30,-91,31])
   self.assertEqual(count,4);self.assertEqual(len(cells),2)
   self.assertAlmostEqual(max(cell[2] for cell in cells),2,places=2)
  finally:codes_release(handle)
if __name__=='__main__':unittest.main()
