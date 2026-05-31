#include "Decorators/BTDecorator_Inverter.h"

BTDecorator_Inverter::BTDecorator_Inverter() { SetName("Inverter"); }

BTStatus BTDecorator_Inverter::Tick(float DeltaTime) {
    if (!Child) return BTStatus::Failure;
    BTStatus Status = Child->Tick(DeltaTime);
    if (Status == BTStatus::Success) return BTStatus::Failure;
    if (Status == BTStatus::Failure) return BTStatus::Success;
    return Status;
}
