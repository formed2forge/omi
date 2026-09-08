import Foundation

extension NotificationCenter {
  /// Observe a notification and run `block` on the main actor, whatever thread posted it.
  ///
  /// `addObserver(forName:object:queue:using:)` with `queue: nil` runs its block
  /// **synchronously on the posting thread**. A block that then calls
  /// `MainActor.assumeIsolated` traps and kills the process the moment any poster is
  /// off the main thread — an owner-fence observer registered by a `@MainActor` store
  /// crashed the app for a background poster this way.
  ///
  /// This helper keeps the synchronous delivery that main-thread posters rely on
  /// (state mutations are visible to the poster's very next statement) and hops to the
  /// main queue only when the poster is on another thread. `queue: .main` is not used
  /// here: an `OperationQueue` observer makes background posters block on the main
  /// thread, which is the deadlock shape documented at the `UserDefaults` observers in
  /// `OmiApp`/`ShellSummon` (#11374).
  @discardableResult
  public func addMainActorObserver(
    forName name: Notification.Name,
    object: Any? = nil,
    using block: @escaping @MainActor @Sendable () -> Void
  ) -> NSObjectProtocol {
    addObserver(forName: name, object: object, queue: nil) { _ in
      if Thread.isMainThread {
        MainActor.assumeIsolated { block() }
      } else {
        DispatchQueue.main.async { MainActor.assumeIsolated { block() } }
      }
    }
  }
}
