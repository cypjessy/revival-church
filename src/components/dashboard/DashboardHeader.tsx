"use client";

export default function DashboardHeader() {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-logo"><i className="fas fa-cross"></i></div>
        <div className="header-text">
          <h1>MOUNTAIN OF DELIVERANCE CHURCH</h1>
        </div>
      </div>
      <div className="header-actions">
        <button className="header-btn">
          <i className="fas fa-magnifying-glass"></i>
        </button>
        <button className="header-btn">
          <i className="fas fa-bell"></i>
          <span className="badge"></span>
        </button>
      </div>
    </header>
  );
}
