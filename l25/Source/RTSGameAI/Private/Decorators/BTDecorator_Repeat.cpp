#include "Decorators/BTDecorator_Repeat.h"

BTDecorator_Repeat::BTDecorator_Repeat() { SetName("Repeat"); }

void BTDecorator_Repeat::Initialize() {
    CurrentCount = 0;
}

BTStatus BTDecorator_Repeat::Tick(float DeltaTime) {
    if (!Child) return BTStatus::Failure;
    BTStatus Status = Child->Tick(DeltaTime);
    if (Status == BTStatus::Success || Status == BTStatus::Failure) {
        CurrentCount++;
        if (MaxRepeats > 0 && CurrentCount >= MaxRepeats) {
            return Status;
        }
        Child->Initialize();
        return BTStatus::Running;
    }
    return Status;
}
