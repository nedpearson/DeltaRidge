import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import { CheckCircle2, MapPin, Search, Calendar, DoorOpen } from 'lucide-react'

export default function TrainingSimulatorPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  const handleNext = () => setStep((s) => s + 1)
  
  return (
    <div className="space-y-6 pb-20">
      <div className="mb-2">
        <h1 className="text-2xl font-bold font-display tracking-tight">Training Simulator</h1>
        <p className="text-sm text-text-secondary mt-1">Interactive walkthrough of the core loop.</p>
      </div>
      
      <div className="flex gap-1 mb-6">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-brand-primary' : 'bg-bg-card ring-1 ring-border-subtle'}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          <SectionTitle>STEP 1: ACQUIRE LOCATION</SectionTitle>
          <Card className="text-center py-10">
            <MapPin className="w-12 h-12 text-brand-primary mx-auto mb-4" />
            <h3 className="font-bold text-lg mb-2">Welcome to the neighborhood!</h3>
            <p className="text-sm text-text-secondary mb-6">
              Imagine you just arrived at your target area. 
              The first step is to locate yourself on the map to find priority doors.
            </p>
            <Button onClick={handleNext} full>Locate Me</Button>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          <SectionTitle>STEP 2: WHY THIS HOUSE</SectionTitle>
          <p className="text-sm text-text-secondary">
            You are near <strong>4431 Ridgeway Dr</strong>. Let's see why it's a good target.
          </p>
          <Card className="border-l-4 border-l-brand-500 bg-brand-500/5">
            <h3 className="font-bold mb-3">4431 Ridgeway Dr</h3>
            <div className="grid grid-cols-2 gap-2 text-[12.5px] mb-4">
              <div className="bg-bg-app/50 p-2 rounded">
                <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Age</span>
                <span className="font-medium text-text-primary">Roof ~17 years</span>
              </div>
              <div className="bg-bg-app/50 p-2 rounded">
                <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Storm</span>
                <span className="font-bold text-status-warning">1.75" hail</span>
              </div>
            </div>
            <Button variant="primary" onClick={handleNext} full>Review Complete</Button>
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          <SectionTitle>STEP 3: START ROUTE</SectionTitle>
          <Card className="text-center py-10">
            <Search className="w-12 h-12 text-brand-primary mx-auto mb-4" />
            <h3 className="font-bold text-lg mb-2">Ready to knock?</h3>
            <p className="text-sm text-text-secondary mb-6">
              You reviewed the data. You are walking up the driveway. Start the route to track your path.
            </p>
            <Button onClick={handleNext} full>Start Route</Button>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          <SectionTitle>STEP 4: KNOCK & RECORD OUTCOME</SectionTitle>
          <p className="text-sm text-text-secondary">
            You knocked and spoke with the homeowner. They want to schedule an inspection!
            Record the outcome below.
          </p>
          <Card>
            <DoorOpen className="w-8 h-8 text-text-secondary mb-4 mx-auto" />
            <h3 className="font-bold mb-4 text-center">Outcome Picker</h3>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => alert('Not quite! The homeowner agreed to an inspection. Try again.')}>Not Home</Button>
              <Button variant="secondary" onClick={() => alert('Not quite! The homeowner agreed to an inspection. Try again.')}>Not Interested</Button>
              <Button variant="primary" onClick={handleNext}>Booked Appointment</Button>
            </div>
          </Card>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          <SectionTitle>STEP 5: BOOK APPOINTMENT</SectionTitle>
          <p className="text-sm text-text-secondary">
            Awesome! The last step is to lock in the appointment time.
          </p>
          <Card className="py-6 text-center">
            <Calendar className="w-8 h-8 text-brand-primary mx-auto mb-4" />
            <h3 className="font-bold mb-2">Schedule Inspection</h3>
            <p className="text-sm text-text-secondary mb-6">Mock calendar time slot: Tomorrow at 10:00 AM</p>
            <Button onClick={handleNext} full>Confirm Appointment</Button>
          </Card>
        </div>
      )}

      {step > 5 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 text-center py-10">
          <CheckCircle2 className="w-16 h-16 text-status-success mx-auto mb-4" />
          <h2 className="text-2xl font-bold font-display mb-2">Training Complete!</h2>
          <p className="text-sm text-text-secondary mb-8">
            You successfully completed the core loop. You are ready for the field.
          </p>
          <Button onClick={() => navigate('/')} full>Return to Dashboard</Button>
        </div>
      )}
    </div>
  )
}
