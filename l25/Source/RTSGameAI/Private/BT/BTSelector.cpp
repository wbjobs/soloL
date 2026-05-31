#include "BT/BTSelector.h"

void BTSelector::Initialize() {
    CurrentChildIndex = 0;
}

BTStatus BTSelector::Tick(float DeltaTime) {
    while (CurrentChildIndex < Children.size()) {
        BTStatus Status = Children[CurrentChildIndex]->Tick(DeltaTime);
        if (Status == BTStatus::Running) {
            return BTStatus::Running;
        }
        if (Status == BTStatus::Success) {
            CurrentChildIndex = 0;
            return BTStatus::Success;
        }
        CurrentChildIndex++;
    }
    CurrentChildIndex = 0;
    return BTStatus::Failure;
}
