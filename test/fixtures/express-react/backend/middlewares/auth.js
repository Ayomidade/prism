function protect(req, res, next) {
  next();
}

function authorize(...roles) {
  return (req, res, next) => {
    next();
  };
}

module.exports = { protect, authorize };
