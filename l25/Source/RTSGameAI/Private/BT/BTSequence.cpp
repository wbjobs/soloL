#include "BT/BTSequence.h"

void BTSequence::Initialize() {
    CurrentChildIndex = 0;
}

BTStatus BTSequence::Tick(float DeltaTime) {
    while (CurrentChildIndex < Children.size()) {
        BTStatus Status = Children[CurrentChildIndex]->Tick(DeltaTime);
        if (Status == BTStatus::Running) {
            return BTStatus::Running;
        }
        if (Status == BTStatus::Failure) {
            CurrentChildIndex = 0;
            return BTStatus::Failure;
        }
        CurrentChildIndex++;
    }
    CurrentChildIndex = 0;
    return BTStatus::Success;
}
