#include "Decorators/BTDecorator_Cooldown.h"

BTDecorator_Cooldown::BTDecorator_Cooldown() { SetName("Cooldown"); }

void BTDecorator_Cooldown::Initialize() {
    CooldownRemaining = 0.f;
}

BTStatus BTDecorator_Cooldown::Tick(float DeltaTime) {
    if (CooldownRemaining > 0.f) {
        CooldownRemaining -= DeltaTime;
        return BTStatus::Failure;
    }
    if (!Child) return BTStatus::Failure;
    BTStatus Status = Child->Tick(DeltaTime);
    if (Status == BTStatus::Success || Status == BTStatus::Failure) {
        CooldownRemaining = CooldownDuration;
    }
    return Status;
}
