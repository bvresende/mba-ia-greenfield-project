export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor(message = 'Video not found') {
    super('VIDEO_NOT_FOUND', 404, message);
  }
}

export class VideoAccessDeniedException extends DomainException {
  constructor(message = 'Access denied to this video') {
    super('VIDEO_ACCESS_DENIED', 403, message);
  }
}

export class ChannelRequiredException extends DomainException {
  constructor(message = 'User must have a channel to upload videos') {
    super('CHANNEL_REQUIRED', 403, message);
  }
}

export class InvalidVideoStateException extends DomainException {
  constructor(message = 'Operation not permitted in current video state') {
    super('INVALID_VIDEO_STATE', 409, message);
  }
}

export class FileTooLargeException extends DomainException {
  constructor(message = 'File size exceeds maximum allowed limit of 10GB') {
    super('FILE_TOO_LARGE', 400, message);
  }
}

export class InvalidFileTypeException extends DomainException {
  constructor(message = 'Unsupported MIME type for video upload') {
    super('INVALID_FILE_TYPE', 400, message);
  }
}

export class UploadIncompleteException extends DomainException {
  constructor(message = 'Upload parts are incomplete or missing') {
    super('UPLOAD_INCOMPLETE', 400, message);
  }
}

